import Foundation
import React
#if canImport(FoundationModels)
import FoundationModels
#endif

@objc(AppleFoundationModelsModule)
public final class AppleFoundationModelsModule: RCTEventEmitter {
  private final class RequestSlot {
    let id: String
    let completion: ((NSDictionary?, NSError?) -> Void)?
    let event: ((NSDictionary) -> Void)?
    var task: Task<Void, Never>?
    var cancelled = false
    var finished = false
    init(_ id: String, _ completion: ((NSDictionary?, NSError?) -> Void)?, _ event: ((NSDictionary) -> Void)?) {
      self.id = id
      self.completion = completion
      self.event = event
    }
  }

  private let lock = NSLock()
  private var requests: [String: RequestSlot] = [:]

  @objc override public static func requiresMainQueueSetup() -> Bool { false }
  override public func supportedEvents() -> [String]! { ["AppleFoundationModelsEvent"] }

  @objc(getAvailability:rejecter:)
  public func getAvailability(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(availability())
  }

  @objc(generate:requestId:resolver:rejecter:)
  public func generate(_ payload: NSDictionary, requestId: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else { rejectPromise(reject, failure("APPLE_MODEL_UNAVAILABLE", "Foundation Models requires iOS 26.", "unsupportedDevice")); return }
    let status = availability()["status"] as? String ?? "unsupportedDevice"
    guard status == "available" else { rejectPromise(reject, failure("APPLE_MODEL_UNAVAILABLE", "Apple Foundation Models is unavailable.", status)); return }
    let completion: (NSDictionary?, NSError?) -> Void = { value, error in
      if let error { self.rejectPromise(reject, error) } else { resolve(value ?? NSDictionary()) }
    }
    guard let slot = register(requestId, completion, nil) else {
      rejectPromise(reject, failure("INVALID_REQUEST", "Duplicate request id.", nil)); return
    }
    let task = Task { [weak self] in
      guard let self, self.isActive(slot) else { return }
      do {
        let result = try await self.generate(payload, requestId: requestId)
        if self.finish(slot) { completion(result as NSDictionary, nil) }
      } catch {
        if self.finish(slot) { completion(nil, self.nativeFailure(error)) }
      }
    }
    attach(task, slot)
    #else
    rejectPromise(reject, failure("APPLE_MODEL_UNAVAILABLE", "Foundation Models is unavailable.", "unsupportedDevice"))
    #endif
  }

  @objc(startStream:requestId:)
  public func startStream(_ payload: NSDictionary, requestId: String) {
    let event: (NSDictionary) -> Void = { [weak self] value in
      DispatchQueue.main.async { [weak self] in
        self?.sendEvent(withName: "AppleFoundationModelsEvent", body: ["requestId": requestId, "packet": value])
      }
    }
    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else { event(packet("error", "APPLE_MODEL_UNAVAILABLE", "Foundation Models requires iOS 26.", "unsupportedDevice")); return }
    let status = availability()["status"] as? String ?? "unsupportedDevice"
    guard status == "available" else { event(packet("error", "APPLE_MODEL_UNAVAILABLE", "Apple Foundation Models is unavailable.", status)); return }
    guard let slot = register(requestId, nil, event) else { event(packet("error", "INVALID_REQUEST", "Duplicate request id.", nil)); return }
    let task = Task { [weak self] in
      guard let self, self.isActive(slot) else { return }
      do { try await self.stream(payload, slot) }
      catch { if self.finish(slot) { event(self.packet("error", "GENERATION_FAILED", error.localizedDescription, nil)) } }
    }
    attach(task, slot)
    #else
    event(packet("error", "APPLE_MODEL_UNAVAILABLE", "Foundation Models is unavailable.", "unsupportedDevice"))
    #endif
  }

  @objc(cancel:)
  public func cancel(_ requestId: String) {
    lock.lock()
    guard let slot = requests[requestId], !slot.finished else { lock.unlock(); return }
    slot.cancelled = true
    slot.finished = true
    requests.removeValue(forKey: requestId)
    let task = slot.task
    lock.unlock()
    task?.cancel()
    slot.completion?(nil, failure("APPLE_MODEL_CANCELLED", "Apple model request was cancelled.", nil))
    slot.event?(["type": "cancelled"] as NSDictionary)
  }

  private func availability() -> [String: Any] {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available:
        return ["status": SystemLanguageModel.default.supportsLocale(Locale(identifier: "ko-KR")) ? "available" : "unsupportedLanguage"]
      case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible: return ["status": "unsupportedDevice"]
        case .appleIntelligenceNotEnabled: return ["status": "disabled"]
        case .modelNotReady: return ["status": "modelNotReady"]
        }
      }
    }
    #endif
    return ["status": "unsupportedDevice"]
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private func generate(_ payload: NSDictionary, requestId: String) async throws -> [String: Any] {
    guard let request = payload as? [String: Any], let prompt = request["prompt"] as? String,
      let instructions = request["instructions"] as? String else {
      throw failure("INVALID_REQUEST", "Prompt and instructions are required.", nil)
    }
    let session = LanguageModelSession(instructions: instructions)
    let options = GenerationOptions(temperature: request["temperature"] as? Double,
      maximumResponseTokens: request["maxOutputTokens"] as? Int)
    guard let raw = request["schema"] as? [String: Any] else {
      guard request["mode"] as? String == "text" else { throw failure("INVALID_REQUEST", "Guided generation needs a schema.", nil) }
      let response = try await session.respond(to: prompt, options: options)
      return ["text": response.content, "toolCalls": [], "finishReason": "complete"]
    }
    let schema = try GenerationSchema(root: AppleFoundationModelsCodec.schema(raw), dependencies: [])
    let response = try await session.respond(to: prompt, schema: schema, options: options)
    return try AppleFoundationModelsCodec.normalize(response.content.jsonString, request, requestId: requestId)
  }

  @available(iOS 26.0, *)
  private func stream(_ payload: NSDictionary, _ slot: RequestSlot) async throws {
    guard let request = payload as? [String: Any], request["mode"] as? String == "text",
      request["schema"] == nil, let prompt = request["prompt"] as? String,
      let instructions = request["instructions"] as? String else {
      throw failure("UNSUPPORTED_CAPABILITY", "Streaming supports text requests only.", nil)
    }
    let session = LanguageModelSession(instructions: instructions)
    let options = GenerationOptions(temperature: request["temperature"] as? Double,
      maximumResponseTokens: request["maxOutputTokens"] as? Int)
    var previous = ""
    for try await snapshot in session.streamResponse(to: prompt, options: options) {
      if Task.isCancelled { return }
      let current = String(describing: snapshot.content)
      guard current.hasPrefix(previous) else {
        if finish(slot) { slot.event?(packet("error", "STREAM_REWRITE", "A prior text snapshot was rewritten.", nil)) }
        return
      }
      guard emitIfActive(slot, ["type": "snapshot", "text": current] as NSDictionary) else { return }
      previous = current
    }
    if finish(slot) {
      slot.event?(["type": "completed", "response": ["text": previous, "toolCalls": [], "finishReason": "complete"]] as NSDictionary)
    }
  }
  #endif

  private func register(_ id: String, _ completion: ((NSDictionary?, NSError?) -> Void)?,
    _ event: ((NSDictionary) -> Void)?) -> RequestSlot? {
    lock.lock(); defer { lock.unlock() }
    guard requests[id] == nil else { return nil }
    let slot = RequestSlot(id, completion, event)
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
    lock.lock(); defer { lock.unlock() }
    return requests[slot.id] === slot && !slot.cancelled && !slot.finished
  }

  private func emitIfActive(_ slot: RequestSlot, _ value: NSDictionary) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard requests[slot.id] === slot, !slot.cancelled, !slot.finished else { return false }
    slot.event?(value)
    return true
  }

  private func finish(_ slot: RequestSlot) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard requests[slot.id] === slot, !slot.cancelled, !slot.finished else { return false }
    slot.finished = true
    requests.removeValue(forKey: slot.id)
    return true
  }

  private func packet(_ type: String, _ code: String?, _ message: String?, _ status: String?) -> NSDictionary {
    var value: [String: Any] = ["type": type]
    if let code { value["code"] = code }
    if let message { value["message"] = message }
    if let status { value["status"] = status }
    return value as NSDictionary
  }

  private func failure(_ code: String, _ message: String, _ status: String?) -> NSError {
    var info: [String: Any] = [NSLocalizedDescriptionKey: message, "code": code]
    if let status { info["status"] = status }
    return NSError(domain: "AppleFoundationModels", code: 1, userInfo: info)
  }

  private func nativeFailure(_ error: Error) -> NSError {
    let value = error as NSError
    if value.domain == "AppleFoundationModels", value.userInfo["code"] != nil { return value }
    return failure("GENERATION_FAILED", value.localizedDescription, nil)
  }

  private func rejectPromise(_ reject: RCTPromiseRejectBlock, _ error: NSError) {
    reject(error.userInfo["code"] as? String ?? "APPLE_MODEL_ERROR", error.localizedDescription, error)
  }
}
