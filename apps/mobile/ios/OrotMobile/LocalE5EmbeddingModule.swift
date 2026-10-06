import Foundation
import React

@objc(LocalE5EmbeddingModule)
public final class LocalE5EmbeddingModule: RCTEventEmitter {
    private let lock = NSLock()
    private var requests: [String: LocalE5EmbeddingRequestSlot] = [:]

    @objc override public static func requiresMainQueueSetup() -> Bool {
        false
    }

    override public func supportedEvents() -> [String]! {
        ["LocalE5EmbeddingEvent"]
    }

    @objc(getModelIdentity:rejecter:)
    public func getModelIdentity(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        resolve([
            "id": LocalE5ModelAssets.identifier,
            "revision": LocalE5ModelAssets.revision,
            "dimension": LocalE5ModelAssets.dimension,
            "modelSha256": LocalE5ModelAssets.model.sha256,
            "tokenizerSha256": LocalE5ModelAssets.tokenizer.sha256,
        ])
    }

    @objc(getRuntimeMetrics:rejecter:)
    public func getRuntimeMetrics(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        Task {
            await resolve(LocalE5EmbeddingRuntime.shared.metrics())
        }
    }

    @objc(prepare:resolver:rejecter:)
    public func prepare(
        _ requestId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        start(requestId, resolve: resolve, reject: reject) { [weak self] in
            try await LocalE5EmbeddingRuntime.shared.prepare(requestId: requestId) { [weak self] completed, total in
                guard let self else { return }
                DispatchQueue.main.async {
                    self.sendEvent(
                        withName: "LocalE5EmbeddingEvent",
                        body: ["requestId": requestId, "completed": completed, "total": total],
                    )
                }
            }
            return ["prepared": true]
        }
    }

    @objc(embedBatch:role:requestId:resolver:rejecter:)
    public func embedBatch(
        _ texts: [String],
        role: String,
        requestId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        start(requestId, resolve: resolve, reject: reject) {
            try await LocalE5EmbeddingRuntime.shared.embedBatch(texts, role: role, requestId: requestId)
        }
    }

    @objc(cancel:)
    public func cancel(_ requestId: String) {
        lock.lock()
        let slot = requests.removeValue(forKey: requestId)
        slot?.cancelled = true
        slot?.finished = true
        let task = slot?.task
        lock.unlock()

        task?.cancel()
        Task { await LocalE5EmbeddingRuntime.shared.cancel(requestId: requestId) }
        slot?.reject(
            "LOCAL_EMBEDDING_CANCELLED",
            "The local embedding request was cancelled.",
            NSError(domain: "LocalE5Embedding", code: 1),
        )
    }

    private func start(
        _ requestId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock,
        operation: @escaping () async throws -> Any,
    ) {
        guard let slot = register(requestId, reject: reject) else {
            reject("DUPLICATE_REQUEST_ID", "A local embedding request with this ID is already active.", nil)
            return
        }

        let task = Task { [weak self] in
            do {
                let result = try await operation()
                if let self, finish(slot) {
                    resolve(result)
                }
            } catch {
                if let self, finish(slot) {
                    reject(failureCode(error), error.localizedDescription, error as NSError)
                }
            }
        }
        attach(task, to: slot)
    }

    private func register(_ requestId: String, reject: @escaping RCTPromiseRejectBlock) -> LocalE5EmbeddingRequestSlot? {
        lock.lock()
        defer { lock.unlock() }
        guard requests[requestId] == nil else { return nil }
        let slot = LocalE5EmbeddingRequestSlot(requestId: requestId, reject: reject)
        requests[requestId] = slot
        return slot
    }

    private func attach(_ task: Task<Void, Never>, to slot: LocalE5EmbeddingRequestSlot) {
        lock.lock()
        let wasCancelled = slot.cancelled || slot.finished || requests[slot.requestId] !== slot
        if !wasCancelled {
            slot.task = task
        }
        lock.unlock()
        if wasCancelled {
            task.cancel()
        }
    }

    private func finish(_ slot: LocalE5EmbeddingRequestSlot) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard requests[slot.requestId] === slot, !slot.cancelled, !slot.finished else { return false }
        slot.finished = true
        requests.removeValue(forKey: slot.requestId)
        return true
    }

    private func failureCode(_ error: Error) -> String {
        if let runtimeError = error as? LocalE5EmbeddingRuntimeError {
            return runtimeError.code
        }
        if error is CancellationError || (error as NSError).code == NSURLErrorCancelled {
            return "LOCAL_EMBEDDING_CANCELLED"
        }
        return "LOCAL_EMBEDDING_FAILED"
    }
}
