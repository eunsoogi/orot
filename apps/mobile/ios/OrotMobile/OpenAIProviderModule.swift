import Foundation
import OpenAIProvider
import React

@objc(OpenAIProviderModule)
public final class OpenAIProviderModule: RCTEventEmitter {
  private final class RequestSlot {
    let id: String
    let event: (NSDictionary) -> Void
    var task: Task<Void, Never>?
    var cancelled = false
    var finished = false
    init(_ id: String, _ event: @escaping (NSDictionary) -> Void) { self.id = id; self.event = event }
  }

  private let lock = NSLock()
  private var requests: [String: RequestSlot] = [:]
  private let defaultClient = ChatGPTOAuthClient()
  #if DEBUG && targetEnvironment(simulator)
  private var simulatorFixture: ChatGPTPlanSimulatorFixture?
  #endif

  @objc override public static func requiresMainQueueSetup() -> Bool { false }
  override public func supportedEvents() -> [String]! { ["OpenAIProviderEvent"] }

  @objc(listModels:resolver:rejecter:)
  public func listModels(_ issuedClientID: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        let models = try await activeClient.listModels(forIssuedClientID: issuedClientID)
        resolve(models.map { ["slug": $0.slug, "displayName": $0.displayName] as NSDictionary })
      } catch {
        let details = Self.failureDetails(error)
        let message = details["message"] as? String ?? "ChatGPT model discovery failed."
        var userInfo = details
        userInfo[NSLocalizedDescriptionKey] = message
        let rejection = NSError(
          domain: "OpenAIProvider",
          code: details["httpStatusCode"] as? Int ?? 1,
          userInfo: userInfo
        )
        reject(details["code"] as? String ?? "CHATGPT_PROVIDER_ERROR", message, rejection)
      }
    }
  }

  @objc(startResponse:requestId:issuedClientID:)
  public func startResponse(_ payload: NSDictionary, requestId: String, issuedClientID: String) {
    let event: (NSDictionary) -> Void = { [weak self] value in
      DispatchQueue.main.async { [weak self] in
        self?.sendEvent(withName: "OpenAIProviderEvent", body: ["requestId": requestId, "packet": value])
      }
    }
    guard let slot = register(requestId, event) else {
      event(["type": "failed", "error": ["kind": "invalid_request", "message": "Duplicate request id."]] as NSDictionary)
      return
    }
    let task = Task { [weak self] in
      guard let self, self.isActive(slot) else { return }
      do {
        let request = try Self.decodeRequest(payload)
        let stream = try await self.activeClient.streamResponse(request, forIssuedClientID: issuedClientID)
        for try await packet in stream {
          guard self.isActive(slot) else { return }
          switch packet {
          case .textDelta(let text): slot.event(["type": "text_delta", "text": text] as NSDictionary)
          case .completed(let response):
            if self.finish(slot) { slot.event(["type": "completed", "text": response.text] as NSDictionary) }
            return
          }
        }
        if self.finish(slot) {
          slot.event(["type": "failed", "error": Self.failureDetails(ChatGPTResponsesError.interrupted)] as NSDictionary)
        }
      } catch {
        if self.finish(slot) {
          slot.event(["type": "failed", "error": Self.failureDetails(error)] as NSDictionary)
        }
      }
    }
    attach(task, slot)
  }

  @objc(cancelResponse:)
  public func cancelResponse(_ requestId: String) {
    lock.lock()
    guard let slot = requests[requestId], !slot.finished else { lock.unlock(); return }
    slot.cancelled = true
    slot.finished = true
    requests.removeValue(forKey: requestId)
    let task = slot.task
    lock.unlock()
    task?.cancel()
  }

  #if DEBUG && targetEnvironment(simulator)
  @objc(prepareSyntheticFixture:resolver:rejecter:)
  public func prepareSyntheticFixture(_ scenario: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let value = ChatGPTPlanSimulatorFixture.Scenario(rawValue: scenario) else {
      reject("INVALID_FIXTURE_SCENARIO", "Unknown synthetic fixture scenario.", nil)
      return
    }
    do {
      lock.lock()
      defer { lock.unlock() }
      if let simulatorFixture { simulatorFixture.select(value) }
      else { simulatorFixture = try ChatGPTPlanSimulatorFixture(scenario: value) }
      resolve(["issuedClientID": ChatGPTPlanSimulatorFixture.issuedClientID] as NSDictionary)
    } catch {
      reject("SYNTHETIC_FIXTURE_FAILED", error.localizedDescription, error as NSError)
    }
  }

  @objc(removeSyntheticFixture:rejecter:)
  public func removeSyntheticFixture(_ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock) {
    lock.lock()
    let fixture = simulatorFixture
    simulatorFixture = nil
    lock.unlock()
    do {
      try fixture?.remove()
      resolve(nil)
    } catch {
      reject("SYNTHETIC_FIXTURE_CLEANUP_FAILED", error.localizedDescription, error as NSError)
    }
  }
  #endif

  private var activeClient: ChatGPTOAuthClient {
    #if DEBUG && targetEnvironment(simulator)
    lock.lock()
    let fixtureClient = simulatorFixture?.client
    lock.unlock()
    if let fixtureClient { return fixtureClient }
    #endif
    return defaultClient
  }

  private static func decodeRequest(_ payload: NSDictionary) throws -> ChatGPTResponsesRequest {
    guard let value = payload as? [String: Any],
          let model = value["model"] as? String,
          let rawMessages = value["messages"] as? [[String: Any]],
          !rawMessages.isEmpty else { throw ChatGPTResponsesError.invalidRequest }
    let messages = try rawMessages.map { message -> ChatGPTResponsesMessage in
      guard let role = message["role"] as? String, let content = message["content"] as? String else {
        throw ChatGPTResponsesError.invalidRequest
      }
      switch role {
      case "system": return .system(content)
      case "user": return .user(content)
      case "assistant": return .assistant(content)
      default: throw ChatGPTResponsesError.invalidRequest
      }
    }
    return ChatGPTResponsesRequest(model: model, messages: messages)
  }

  private func register(_ id: String, _ event: @escaping (NSDictionary) -> Void) -> RequestSlot? {
    lock.lock()
    defer { lock.unlock() }
    guard requests[id] == nil else { return nil }
    let slot = RequestSlot(id, event)
    requests[id] = slot
    return slot
  }

  private func attach(_ task: Task<Void, Never>, _ slot: RequestSlot) {
    lock.lock()
    let cancelled = slot.cancelled || slot.finished || requests[slot.id] !== slot
    if !cancelled { slot.task = task }
    lock.unlock()
    if cancelled { task.cancel() }
  }

  private func isActive(_ slot: RequestSlot) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return requests[slot.id] === slot && !slot.cancelled && !slot.finished
  }

  private func finish(_ slot: RequestSlot) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard requests[slot.id] === slot, !slot.cancelled, !slot.finished else { return false }
    slot.finished = true
    requests.removeValue(forKey: slot.id)
    return true
  }

  private static func failureDetails(_ error: Error) -> [String: Any] {
    var result: [String: Any] = ["kind": "provider", "message": error.localizedDescription]
    if let error = error as? ChatGPTResponsesError {
      switch error {
      case .unsupportedCapability: result["kind"] = "unsupported_capability"
      case .unsupportedInput: result["kind"] = "unsupported_input"
      case .transportUnavailable: result["kind"] = "transport"
      case .invalidRequest: result["kind"] = "invalid_request"
      case .incomplete(let details): result["kind"] = "incomplete"; add(details, to: &result)
      case .interrupted: result["kind"] = "interrupted"
      case .httpFailure(let details), .responseFailure(let details): add(details, to: &result)
      case .invalidHTTPResponse, .invalidContentType, .malformedEvent: break
      }
    } else if let error = error as? ChatGPTOAuthError {
      switch error {
      case .planPermissionMissing, .accountNotFound, .reauthorizationRequired, .accountIdentityMismatch:
        result["kind"] = "authentication"
      case .modelCatalogHTTPFailure(let details): add(details, to: &result)
      default: break
      }
    }
    let status = result["httpStatusCode"] as? Int
    let providerCode = result["code"] as? String
    if providerCode == "subscription_sharing_usage_limit_exceeded" || status == 429 {
      result["kind"] = "usage_limit"
      result["code"] = providerCode ?? "rate_limited"
    } else if providerCode == "subscription_sharing_unsupported_capability" {
      result["kind"] = "unsupported_capability"
    } else if providerCode == "subscription_sharing_usage_unavailable" || providerCode == "subscription_sharing_user_unavailable" {
      result["kind"] = "usage_unavailable"
    } else if status == 401 || status == 403 {
      result["kind"] = "authentication"
    } else if status == 400 {
      result["kind"] = "invalid_request"
    }
    if result["code"] == nil { result["code"] = result["kind"] }
    return result
  }

  private static func add(_ details: ChatGPTResponsesDiagnostics, to result: inout [String: Any]) {
    if let httpStatusCode = details.httpStatusCode { result["httpStatusCode"] = httpStatusCode }
    if let bodyShape = details.bodyShape { result["bodyShape"] = bodyShape }
    if let code = details.code { result["code"] = code }
    if let parameter = details.parameter { result["parameter"] = parameter }
    if let requestID = details.requestID { result["requestID"] = requestID }
    if let reason = details.reason { result["reason"] = reason }
    result["bodyTruncated"] = details.bodyTruncated
  }
}
