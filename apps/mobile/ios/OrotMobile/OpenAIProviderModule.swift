import Foundation
import OpenAIProvider
import React

@objc(OpenAIProviderModule)
public final class OpenAIProviderModule: RCTEventEmitter {
    private let responseRequests = OpenAIProviderRequestRegistry()
    private let defaultClient = ChatGPTOAuthClient()
    // Synthetic fixtures are compiled only for Debug Simulators, never production builds.
    #if DEBUG && targetEnvironment(simulator)
        let fixtureLock = NSLock()
        var simulatorFixture: ChatGPTPlanSimulatorFixture?
    #endif

    @objc override public static func requiresMainQueueSetup() -> Bool {
        false
    }

    override public func supportedEvents() -> [String]! {
        ["OpenAIProviderEvent"]
    }

    @objc(listModels:resolver:rejecter:)
    public func listModels(_ issuedClientID: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        Task {
            do {
                let models = try await activeClient.listModels(forIssuedClientID: issuedClientID)
                resolve(models.map { ["slug": $0.slug, "displayName": $0.displayName] as NSDictionary })
            } catch {
                let details = OpenAIProviderErrorDetails.make(error)
                let message = details["message"] as? String ?? "ChatGPT model discovery failed."
                var userInfo = details
                userInfo[NSLocalizedDescriptionKey] = message
                let rejection = NSError(
                    domain: "OpenAIProvider",
                    code: details["httpStatusCode"] as? Int ?? 1,
                    userInfo: userInfo,
                )
                reject(details["code"] as? String ?? "CHATGPT_PROVIDER_ERROR", message, rejection)
            }
        }
    }

    @objc(startResponse:requestId:issuedClientID:)
    public func startResponse(_ payload: NSDictionary, requestId: String, issuedClientID: String) {
        let registration = responseRequests.register(requestId, issuedClientID: issuedClientID) {
            [weak self] requestID, packet in
            self?.sendEvent(
                withName: "OpenAIProviderEvent",
                body: ["requestId": requestID, "packet": packet],
            )
        }
        let slot: OpenAIProviderRequestRegistry.Slot
        switch registration {
        case let .accepted(value): slot = value
        case .duplicate:
            emitRequestFailure(requestId, kind: "invalid_request", message: "Duplicate request id.")
            return
        case .signingOut:
            emitRequestFailure(
                requestId,
                kind: "authentication",
                message: "ChatGPT 계정 로그아웃이 진행 중입니다.",
            )
            return
        }
        let task = Task { [weak self] in
            guard let self, responseRequests.isActive(slot) else { return }
            do {
                let request = try ChatGPTResponsesRequestDecoder.decode(payload)
                let stream = try await activeClient.streamResponse(request, forIssuedClientID: issuedClientID)
                var emittedToolCallIDs = Set<String>()
                for try await packet in stream {
                    guard responseRequests.isActive(slot) else { return }
                    switch packet {
                    case let .textDelta(text): slot.event(["type": "text_delta", "text": text] as NSDictionary)
                    case let .toolCall(toolCall):
                        emittedToolCallIDs.insert(toolCall.id)
                        slot.event(["type": "tool_call", "toolCall": Self.nativeToolCall(toolCall)] as NSDictionary)
                    case let .completed(response):
                        for toolCall in response.toolCalls where !emittedToolCallIDs.contains(toolCall.id) {
                            slot.event(["type": "tool_call", "toolCall": Self.nativeToolCall(toolCall)] as NSDictionary)
                        }
                        if responseRequests.finish(slot) {
                            slot.event([
                                "type": "completed",
                                "text": response.text,
                                "toolCalls": response.toolCalls.map(Self.nativeToolCall),
                                "continuationItems": response.continuationItems,
                            ] as NSDictionary)
                        }
                        return
                    }
                }
                if responseRequests.finish(slot) {
                    slot.event(["type": "failed", "error": OpenAIProviderErrorDetails.make(ChatGPTResponsesError.interrupted)] as NSDictionary)
                }
            } catch {
                if responseRequests.finish(slot) {
                    slot.event(["type": "failed", "error": OpenAIProviderErrorDetails.make(error)] as NSDictionary)
                }
            }
        }
        responseRequests.attach(task, to: slot)
    }

    @objc(cancelResponse:)
    public func cancelResponse(_ requestId: String) {
        responseRequests.cancel(requestID: requestId)?.cancel()
    }

    var activeClient: ChatGPTOAuthClient {
        #if DEBUG && targetEnvironment(simulator)
            fixtureLock.lock()
            let fixtureClient = simulatorFixture?.client
            fixtureLock.unlock()
            if let fixtureClient {
                return fixtureClient
            }
        #endif
        return defaultClient
    }

    #if DEBUG && targetEnvironment(simulator)
        var activeSimulatorFixtureClient: ChatGPTOAuthClient? {
            fixtureLock.lock()
            defer { fixtureLock.unlock() }
            return simulatorFixture?.client
        }
    #endif

    private static func nativeToolCall(_ toolCall: ChatGPTResponsesFunctionCall) -> [String: String] {
        ["id": toolCall.id, "name": toolCall.name, "arguments": toolCall.argumentsJSON]
    }

    /// Invalidate account-scoped streams synchronously before credential clearing begins.
    func beginSignOut(for issuedClientID: String) -> Bool {
        guard let activeRequests = responseRequests.beginSignOut(for: issuedClientID) else {
            return false
        }
        for slot in activeRequests {
            emitRequestFailure(
                slot.id,
                kind: "authentication",
                message: "로그아웃을 시작해 진행 중인 ChatGPT 응답을 중단했어요.",
            )
        }
        return true
    }

    func finishSignOut(for issuedClientID: String) {
        responseRequests.finishSignOut(for: issuedClientID)
    }

    private func emitRequestFailure(_ requestID: String, kind: String, message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.sendEvent(
                withName: "OpenAIProviderEvent",
                body: [
                    "requestId": requestID,
                    "packet": [
                        "type": "failed",
                        "error": ["kind": kind, "code": kind, "message": message],
                    ],
                ],
            )
        }
    }
}
