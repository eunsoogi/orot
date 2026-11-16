import Foundation
import OpenAIProvider
import React

@objc(OpenAIProviderModule)
public final class OpenAIProviderModule: RCTEventEmitter {
    private let responseRequests = OpenAIProviderRequestRegistry()
    private let steeringLock = NSLock()
    private var steeringResponses: [String: ChatGPTSteerableResponse] = [:]
    private let defaultClient = ChatGPTOAuthClient()
    // Device and ordinary Release builds exclude fixtures; OROT_TESTS opts in only on Simulators.
    #if (DEBUG || OROT_TESTS) && targetEnvironment(simulator)
        let fixtureLock = NSLock()
        var simulatorFixture: ChatGPTPlanSimulatorFixture?
    #endif

    @objc override public static func requiresMainQueueSetup() -> Bool {
        false
    }

    override public func supportedEvents() -> [String]! {
        ["OpenAIProviderEvent"]
    }

    @objc(startResponse:requestId:issuedClientID:)
    public func startResponse(_ payload: NSDictionary, requestId: String, issuedClientID: String) {
        startNativeResponse(payload, requestId: requestId, issuedClientID: issuedClientID, steerable: false)
    }

    @objc(startSteerableResponse:requestId:issuedClientID:)
    public func startSteerableResponse(_ payload: NSDictionary, requestId: String, issuedClientID: String) {
        startNativeResponse(payload, requestId: requestId, issuedClientID: issuedClientID, steerable: true)
    }

    @objc(steerResponse:submissionId:text:resolver:rejecter:)
    public func steerResponse(_ requestId: String, submissionId: String, text: String,
                              resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        let handle = steeringLock.withLock { steeringResponses[requestId] }
        Task {
            do {
                guard let handle else { throw ChatGPTResponsesError.interrupted }
                try await handle.steer(submissionID: submissionId, text: text)
                resolve(nil)
            } catch { reject("STEERING_UNAVAILABLE", "Live steering could not be submitted.", nil) }
        }
    }

    private func startNativeResponse(_ payload: NSDictionary, requestId: String, issuedClientID: String, steerable: Bool) {
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
                message: OpenAIProviderAuthCopy.text("logoutInProgress"),
            )
            return
        }
        let task = Task { [weak self] in
            guard let self, responseRequests.isActive(slot) else { return }
            do {
                let request = try ChatGPTResponsesRequestDecoder.decode(payload)
                var handle: ChatGPTSteerableResponse?
                let stream: AsyncThrowingStream<ChatGPTSteerableEvent, Error>
                if steerable {
                    #if (DEBUG || OROT_TESTS) && targetEnvironment(simulator)
                        guard activeSimulatorFixtureClient == nil else {
                            throw ChatGPTResponsesError.unsupportedCapability("live steering in an HTTP-only fixture")
                        }
                    #endif
                    let socket = try await activeClient.steerableResponse(request, forIssuedClientID: issuedClientID)
                    guard responseRequests.isActive(slot) else { await socket.close(); return }
                    handle = socket
                    steeringLock.withLock { steeringResponses[requestId] = socket }
                    stream = await socket.events()
                } else {
                    let source = try await activeClient.streamResponse(request, forIssuedClientID: issuedClientID)
                    stream = AsyncThrowingStream { continuation in
                        let task = Task {
                            do { for try await event in source {
                                continuation.yield(.response(event))
                            }; continuation.finish() } catch { continuation.finish(throwing: error) }
                        }
                        continuation.onTermination = { @Sendable _ in task.cancel() }
                    }
                }
                defer {
                    if let handle {
                        steeringLock.withLock {
                            if steeringResponses[requestId] === handle {
                                steeringResponses.removeValue(forKey: requestId)
                            }
                        }
                        Task { await handle.close() }
                    }
                }
                var emittedToolCallIDs = Set<String>()
                for try await packet in stream {
                    guard responseRequests.isActive(slot) else { return }
                    switch packet {
                    case .ready: slot.event(["type": "steering_ready"] as NSDictionary); continue
                    case let .textSnapshot(text): slot.event(["type": "text_snapshot", "text": text] as NSDictionary); continue
                    case let .steering(id, status, steerID):
                        var value: [String: Any] = ["type": "steering", "submissionId": id, "status": status]
                        if let steerID {
                            value["steerId"] = steerID
                        }
                        slot.event(value as NSDictionary)
                        continue
                    case .response: break
                    }
                    guard case let .response(responsePacket) = packet else { continue }
                    switch responsePacket {
                    case let .textDelta(text): slot.event(["type": "text_delta", "text": text] as NSDictionary)
                    case let .toolCall(toolCall):
                        emittedToolCallIDs.insert(toolCall.id)
                        slot.event(["type": "tool_call", "toolCall": Self.nativeToolCall(toolCall)] as NSDictionary)
                    case let .completed(response):
                        for toolCall in response.toolCalls where !emittedToolCallIDs.contains(toolCall.id) {
                            slot.event(["type": "tool_call", "toolCall": Self.nativeToolCall(toolCall)] as NSDictionary)
                        }
                        if responseRequests.finish(slot) {
                            var payload: [String: Any] = [
                                "type": "completed",
                                "text": response.text,
                                "toolCalls": response.toolCalls.map(Self.nativeToolCall),
                                "continuationItems": response.continuationItems,
                            ]
                            if let usage = response.usage {
                                payload["usage"] = usage.nativePayload
                            }
                            // Public-search output carries provider citations, not fetched originals.
                            if let search = response.webSearch {
                                payload["webSearch"] = [
                                    "callCount": search.callCount,
                                    "citations": search.citations.map { ["url": $0.url, "title": $0.title] },
                                ]
                            }
                            slot.event(payload as NSDictionary)
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
        steeringLock.withLock { steeringResponses.removeValue(forKey: requestId) }?.cancel()
    }

    var activeClient: ChatGPTOAuthClient {
        #if (DEBUG || OROT_TESTS) && targetEnvironment(simulator)
            fixtureLock.lock()
            let fixtureClient = simulatorFixture?.client
            fixtureLock.unlock()
            if let fixtureClient {
                return fixtureClient
            }
        #endif
        return defaultClient
    }

    #if (DEBUG || OROT_TESTS) && targetEnvironment(simulator)
        var activeSimulatorFixtureClient: ChatGPTOAuthClient? {
            fixtureLock.withLock { simulatorFixture?.client }
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
            steeringLock.withLock { steeringResponses.removeValue(forKey: slot.id) }?.cancel()
            emitRequestFailure(
                slot.id,
                kind: "authentication",
                message: OpenAIProviderAuthCopy.text("logoutInterrupted"),
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
