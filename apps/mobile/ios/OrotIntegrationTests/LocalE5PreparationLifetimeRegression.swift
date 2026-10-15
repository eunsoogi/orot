import Foundation
#if canImport(Orot)
    @testable import Orot
#endif

/// Exercises the same lock boundary used by the native emitter while a cancellation competes with a held event.
enum LocalE5PreparationLifetimeRegression {
    static func immediateReplacement(requestId: String) async throws {
        let preparation = LocalE5Preparation<Int>()
        let cancellation = LocalE5PreparationCancellation()
        let oldLoader = LocalE5PreparationLoader()
        let nextLoader = LocalE5PreparationLoader()
        let log = LocalE5PreparationLog()
        let old = Task {
            try await preparation.prepare(requestId: "old", total: 100, cancellation: cancellation, onProgress: { _, _ in }, load: {
                try await oldLoader.load($0, value: 11)
            })
        }
        await oldLoader.started.wait()
        // Model public cancel's synchronous signal, deliberately withholding Task.cancel and its actor cleanup until replacement registers.
        cancellation.cancel()
        let next = Task {
            try await preparation.prepare(requestId: requestId, total: 100, onProgress: { completed, _ in
                await log.append(String(completed))
            }, load: { try await nextLoader.load($0, value: 22) })
        }
        await nextLoader.started.wait()
        old.cancel()
        guard case .failure(is CancellationError) = await old.result else {
            throw LocalE5PreparationRegression.Failure.assertion("Replaced request did not cancel")
        }
        await oldLoader.emit([700], total: 1000)
        await oldLoader.released.open()
        await oldLoader.returning.wait()
        await nextLoader.emit([10, 20], total: 100)
        await nextLoader.released.open()
        guard try await next.value == 22, await log.entries == ["10", "20"], await nextLoader.invocations == 1 else {
            throw LocalE5PreparationRegression.Failure.assertion("Immediate replacement joined or received progress from cancelled work")
        }
        let cached = try await preparation.prepare(requestId: "cached", total: 100, onProgress: { _, _ in }, load: { _ in 99 })
        guard cached == 22 else {
            throw LocalE5PreparationRegression.Failure.assertion("Late cancellation cleanup replaced the cached result")
        }
    }

    static func atomicSubmission() throws {
        let fixture = SubmissionFixture()
        let entered = DispatchSemaphore(value: 0)
        let attempted = DispatchSemaphore(value: 0)
        let cancelled = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            entered.wait()
            // This is the exact lock cancellation and replacement use in the native module.
            if fixture.lock.try() {
                fixture.current = 2
                fixture.lock.unlock()
            }
            attempted.signal()
            fixture.lock.lock()
            fixture.current = 2
            fixture.lock.unlock()
            cancelled.signal()
        }
        LocalE5ProgressDelivery.submit(lock: fixture.lock, isActive: { fixture.current == 1 }) {
            entered.signal()
            attempted.wait()
            fixture.submitted.append(fixture.current)
        }
        cancelled.wait()
        LocalE5ProgressDelivery.submit(lock: fixture.lock, isActive: { fixture.current == 1 }) {
            fixture.submitted.append(1)
        }
        guard fixture.submitted == [1] else {
            throw LocalE5PreparationRegression.Failure.assertion("Cancellation or replacement entered between event validation and submission")
        }
        LocalE5ProgressDelivery.submit(lock: fixture.lock, isActive: { fixture.current == 2 }) {
            fixture.submitted.append(2)
        }
        guard fixture.submitted == [1, 2] else {
            throw LocalE5PreparationRegression.Failure.assertion("Replacement event was lost")
        }
    }

    /// The producer and competing cancellation synchronize all shared access with the lock and semaphores above.
    private final class SubmissionFixture: @unchecked Sendable {
        let lock = NSLock()
        var current = 1
        var submitted: [Int] = []
    }
}
