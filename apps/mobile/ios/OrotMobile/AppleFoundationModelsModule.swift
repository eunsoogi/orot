import Foundation
import React
#if canImport(FoundationModels)
    import FoundationModels
#endif

@objc(AppleFoundationModelsModule)
public final class AppleFoundationModelsModule: RCTEventEmitter {
    private let lock = NSLock()
    private var requests: [String: AppleFoundationModelsRequestSlot] = [:]

    @objc override public static func requiresMainQueueSetup() -> Bool {
        false
    }

    override public func supportedEvents() -> [String]! {
        ["AppleFoundationModelsEvent"]
    }

    @objc(getAvailability:rejecter:)
    public func getAvailability(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        resolve(availability())
    }

    @objc(generate:requestId:resolver:rejecter:)
    public func generate(_ payload: NSDictionary, requestId: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        #if canImport(FoundationModels)
            guard #available(iOS 26.0, *) else { rejectApplePromise(reject, appleFoundationModelsFailure("APPLE_MODEL_UNAVAILABLE", "Foundation Models requires iOS 26.", "unsupportedDevice")); return }
            let status = availability()["status"] as? String ?? "unsupportedDevice"
            guard status == "available" else { rejectApplePromise(reject, appleFoundationModelsFailure("APPLE_MODEL_UNAVAILABLE", "Apple Foundation Models is unavailable.", status)); return }
            let completion: (NSDictionary?, NSError?) -> Void = { value, error in
                if let error {
                    rejectApplePromise(reject, error)
                } else {
                    resolve(value ?? NSDictionary())
                }
            }
            guard let slot = register(requestId, completion, nil) else {
                rejectApplePromise(reject, appleFoundationModelsFailure("INVALID_REQUEST", "Duplicate request id.", nil)); return
            }
            let task = Task { [weak self] in
                guard let self, isActive(slot) else { return }
                do {
                    let result = try await AppleFoundationModelsSession.generate(payload, requestId: requestId)
                    if finish(slot) {
                        completion(result as NSDictionary, nil)
                    }
                } catch {
                    if finish(slot) {
                        completion(nil, appleFoundationModelsNativeFailure(error))
                    }
                }
            }
            attach(task, slot)
        #else
            rejectApplePromise(reject, appleFoundationModelsFailure("APPLE_MODEL_UNAVAILABLE", "Foundation Models is unavailable.", "unsupportedDevice"))
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
            guard #available(iOS 26.0, *) else { event(appleFoundationModelsPacket("error", "APPLE_MODEL_UNAVAILABLE", "Foundation Models requires iOS 26.", "unsupportedDevice")); return }
            let status = availability()["status"] as? String ?? "unsupportedDevice"
            guard status == "available" else { event(appleFoundationModelsPacket("error", "APPLE_MODEL_UNAVAILABLE", "Apple Foundation Models is unavailable.", status)); return }
            guard let slot = register(requestId, nil, event) else { event(appleFoundationModelsPacket("error", "INVALID_REQUEST", "Duplicate request id.", nil)); return }
            let task = Task { [weak self] in
                guard let self, isActive(slot) else { return }
                do { try await stream(payload, slot) }
                catch {
                    if finish(slot) {
                        event(appleFoundationModelsPacket("error", "GENERATION_FAILED", error.localizedDescription, nil))
                    }
                }
            }
            attach(task, slot)
        #else
            event(appleFoundationModelsPacket("error", "APPLE_MODEL_UNAVAILABLE", "Foundation Models is unavailable.", "unsupportedDevice"))
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
        slot.completion?(nil, appleFoundationModelsFailure("APPLE_MODEL_CANCELLED", "Apple model request was cancelled.", nil))
        slot.event?(["type": "cancelled"] as NSDictionary)
    }

    private func availability() -> [String: Any] {
        #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                return AppleFoundationModelsSession.availability()
            }
        #endif
        return ["status": "unsupportedDevice"]
    }

    #if canImport(FoundationModels)
        @available(iOS 26.0, *)
        private func stream(_ payload: NSDictionary, _ slot: AppleFoundationModelsRequestSlot) async throws {
            var previous = ""
            try await AppleFoundationModelsSession.stream(payload) { current in
                if Task.isCancelled {
                    return false
                }
                guard current.hasPrefix(previous) else {
                    if self.finish(slot) {
                        slot.event?(appleFoundationModelsPacket("error", "STREAM_REWRITE", "A prior text snapshot was rewritten.", nil))
                    }
                    return false
                }
                guard self.emitIfActive(slot, ["type": "snapshot", "text": current] as NSDictionary) else { return false }
                previous = current
                return true
            }
            if finish(slot) {
                slot.event?(["type": "completed", "response": ["text": previous, "toolCalls": [], "finishReason": "complete"]] as NSDictionary)
            }
        }
    #endif

    private func register(_ id: String, _ completion: ((NSDictionary?, NSError?) -> Void)?,
                          _ event: ((NSDictionary) -> Void)?) -> AppleFoundationModelsRequestSlot?
    {
        lock.lock(); defer { lock.unlock() }
        guard requests[id] == nil else { return nil }
        let slot = AppleFoundationModelsRequestSlot(id, completion, event)
        requests[id] = slot
        return slot
    }

    private func attach(_ task: Task<Void, Never>, _ slot: AppleFoundationModelsRequestSlot) {
        lock.lock()
        let cancelled = slot.cancelled || slot.finished || requests[slot.id] !== slot
        if !cancelled {
            slot.task = task
        }
        lock.unlock()
        if cancelled {
            task.cancel()
        }
    }

    private func isActive(_ slot: AppleFoundationModelsRequestSlot) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return requests[slot.id] === slot && !slot.cancelled && !slot.finished
    }

    private func emitIfActive(_ slot: AppleFoundationModelsRequestSlot, _ value: NSDictionary) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard requests[slot.id] === slot, !slot.cancelled, !slot.finished else { return false }
        slot.event?(value)
        return true
    }

    private func finish(_ slot: AppleFoundationModelsRequestSlot) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard requests[slot.id] === slot, !slot.cancelled, !slot.finished else { return false }
        slot.finished = true
        requests.removeValue(forKey: slot.id)
        return true
    }
}
