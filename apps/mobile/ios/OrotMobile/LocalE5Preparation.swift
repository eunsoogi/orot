import Foundation

/// Shares one preparation while preserving the producer's progress order and each caller's lifetime.
actor LocalE5Preparation<Value> {
    typealias Progress = (Int64, Int64) async -> Void
    typealias Loader = (@escaping (Int64, Int64) -> Void) async throws -> Value

    private struct Subscriber {
        let token: UUID
        let generation: UUID
        let progress: Progress
        let continuation: CheckedContinuation<Value, Error>
    }

    private struct Flight {
        let generation: UUID
        let stream: AsyncStream<(Int64, Int64)>.Continuation
        let delivery: Task<Void, Never>
        let work: Task<Void, Never>
    }

    private var cached: Value?
    private var flight: Flight?
    private var subscribers: [String: Subscriber] = [:]

    /// A bounded diagnostic also lets regressions synchronize registration without scheduler delays.
    var activeRequestCount: Int {
        subscribers.count
    }

    func prepare(requestId: String, total: Int64, onProgress: @escaping Progress, load: @escaping Loader) async throws -> Value {
        try Task.checkCancellation()
        if let cached {
            await onProgress(total, total)
            try Task.checkCancellation()
            return cached
        }
        let token = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                // Cancellation before registration must not leave an unobserved shared download behind.
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                guard subscribers[requestId] == nil else {
                    continuation.resume(throwing: PreparationError.duplicateRequest)
                    return
                }
                let generation = flight?.generation ?? UUID()
                subscribers[requestId] = Subscriber(token: token, generation: generation, progress: onProgress, continuation: continuation)
                if flight == nil {
                    start(generation: generation, load: load)
                }
            }
        } onCancel: {
            Task { await self.cancel(requestId: requestId, token: token) }
        }
    }

    private func start(generation: UUID, load: @escaping Loader) {
        // Synchronous yields retain callback arrival order. One consumer awaits every delivery; no per-event Tasks race for this actor.
        let (stream, continuation) = AsyncStream<(Int64, Int64)>.makeStream()
        let delivery = Task {
            for await (completed, total) in stream {
                guard !Task.isCancelled else { break }
                await deliver(completed, total: total, generation: generation)
            }
        }
        let work = Task {
            let result: Result<Value, Error>
            do {
                result = try await .success(load { continuation.yield(($0, $1)) })
            } catch {
                result = .failure(error)
            }
            continuation.finish()
            // Draining includes the asynchronous native event submission, on success and failure alike.
            await delivery.value
            settle(generation: generation, result: Task.isCancelled ? .failure(CancellationError()) : result)
        }
        flight = Flight(generation: generation, stream: continuation, delivery: delivery, work: work)
    }

    private func deliver(_ completed: Int64, total: Int64, generation: UUID) async {
        for (requestId, subscriber) in subscribers where subscriber.generation == generation {
            // Awaiting a consumer is reentrant: cancellation or replacement can happen between subscribers.
            guard flight?.generation == generation else { return }
            guard subscribers[requestId]?.token == subscriber.token else { continue }
            await subscriber.progress(completed, total)
        }
    }

    private func cancel(requestId: String, token: UUID) {
        guard let subscriber = subscribers[requestId], subscriber.token == token else { return }
        subscribers.removeValue(forKey: requestId)
        subscriber.continuation.resume(throwing: CancellationError())
        guard subscribers.isEmpty, let old = flight else { return }
        // Detach before cancellation so a replacement cannot join or be cleared by the old task.
        flight = nil
        old.stream.finish()
        old.delivery.cancel()
        old.work.cancel()
    }

    private func settle(generation: UUID, result: Result<Value, Error>) {
        guard flight?.generation == generation else { return }
        if case let .success(value) = result {
            cached = value
        }
        flight = nil
        let finished = subscribers.filter { $0.value.generation == generation }
        for (requestId, subscriber) in finished {
            subscribers.removeValue(forKey: requestId)
            subscriber.continuation.resume(with: result)
        }
    }

    private enum PreparationError: Error { case duplicateRequest }
}
