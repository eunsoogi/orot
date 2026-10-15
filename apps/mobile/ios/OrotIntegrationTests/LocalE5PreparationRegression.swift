import Foundation
#if canImport(Orot)
    @testable import Orot
#endif

/// Runs with the original fresh-model case, preserving the native case inventory and the real download/retrieval assertions.
enum LocalE5PreparationRegression {
    enum Failure: Error { case assertion(String), expectedLoaderFailure }

    static func verify() async throws {
        try await burstAndDrain(fails: false)
        try await burstAndDrain(fails: true)
        try await sharedSubscribers()
        try await cancelledGeneration()
    }

    private static func burstAndDrain(fails: Bool) async throws {
        let preparation = LocalE5Preparation<Int>()
        let loader = LocalE5PreparationLoader()
        let log = LocalE5PreparationLog()
        let entered = LocalE5PreparationGate()
        let consumer = LocalE5PreparationGate()
        let task = Task {
            do {
                let result = try await preparation.prepare(requestId: "burst", total: 4096, onProgress: { completed, total in
                    if completed == 1 {
                        await entered.open()
                        await consumer.wait()
                    }
                    await log.append("\(completed)/\(total)")
                }, load: { try await loader.load($0, value: 17, fails: fails) })
                await log.append("settled")
                return result
            } catch {
                await log.append("failed")
                throw error
            }
        }
        await loader.started.wait()
        await loader.emit(Array(1 ... 4096))
        await entered.wait()
        await loader.released.open()
        await loader.returning.wait()
        try await require(log.entries.isEmpty, "Preparation settled while its consumer was held")
        await consumer.open()
        let result = await task.result
        if fails {
            guard case .failure(Failure.expectedLoaderFailure) = result else { throw Failure.assertion("Loader failure was lost") }
        } else {
            try require(result.get() == 17, "Prepared value changed")
        }
        let expected = (1 ... 4096).map { "\($0)/4096" } + [fails ? "failed" : "settled"]
        try await require(log.entries == expected, "Burst order or completion drain changed")
        if fails {
            let recovered = try await preparation.prepare(requestId: "recovery", total: 1, onProgress: { _, _ in }, load: { _ in 23 })
            try require(recovered == 23, "Failed preparation prevented recovery")
        }
    }

    private static func sharedSubscribers() async throws {
        let preparation = LocalE5Preparation<Int>()
        let loader = LocalE5PreparationLoader()
        let firstLog = LocalE5PreparationLog()
        let secondLog = LocalE5PreparationLog()
        let first = Task {
            try await preparation.prepare(requestId: "first", total: 4096, onProgress: { completed, total in
                await firstLog.append("\(completed)/\(total)")
            }, load: { try await loader.load($0, value: 31) })
        }
        await loader.started.wait()
        let second = Task {
            try await preparation.prepare(requestId: "second", total: 4096, onProgress: { completed, total in
                await secondLog.append("\(completed)/\(total)")
            }, load: { try await loader.load($0, value: 99) })
        }
        await registered(2, preparation: preparation)
        await loader.emit(Array(1 ... 32))
        while await firstLog.entries.count < 32 {
            await Task.yield()
        }
        while await secondLog.entries.count < 32 {
            await Task.yield()
        }
        first.cancel()
        try await cancelled(first)
        try await require(preparation.activeRequestCount == 1, "One cancellation removed a surviving subscriber")
        await loader.emit(Array(33 ... 64))
        await loader.released.open()
        try await require(second.value == 31, "Concurrent requests did not share the original preparation")
        try await require(loader.invocations == 1, "Concurrent callers started duplicate preparations")
        try await require(firstLog.entries == (1 ... 32).map { "\($0)/4096" }, "Cancelled subscriber received later progress")
        try await require(secondLog.entries == (1 ... 64).map { "\($0)/4096" }, "Surviving subscriber lost ordered progress")
    }

    private static func cancelledGeneration() async throws {
        let preparation = LocalE5Preparation<Int>()
        let oldLoader = LocalE5PreparationLoader()
        let nextLoader = LocalE5PreparationLoader()
        let oldLog = LocalE5PreparationLog()
        let nextLog = LocalE5PreparationLog()
        let oldEntered = LocalE5PreparationGate()
        let oldConsumer = LocalE5PreparationGate()
        let oldExited = LocalE5PreparationGate()
        let old = Task {
            try await preparation.prepare(requestId: "reused", total: 100, onProgress: { completed, _ in
                await oldLog.append(String(completed))
                await oldEntered.open()
                await oldConsumer.wait()
                await oldExited.open()
            }, load: { try await oldLoader.load($0, value: 11) })
        }
        await oldLoader.started.wait()
        await oldLoader.emit([1], total: 100)
        await oldEntered.wait()
        old.cancel()
        try await cancelled(old)
        let next = Task {
            try await preparation.prepare(requestId: "reused", total: 100, onProgress: { completed, _ in
                await nextLog.append(String(completed))
            }, load: { try await nextLoader.load($0, value: 22) })
        }
        await nextLoader.started.wait()
        await oldLoader.emit([700, 800], total: 1000)
        await oldLoader.released.open()
        await oldLoader.returning.wait()
        // A descending fixture verifies preservation of producer values, rather than sorting or clamping observations.
        await nextLoader.emit([10, 20, 5], total: 100)
        await nextLoader.released.open()
        // A replacement must finish even while a cancelled generation's already-entered consumer is still held.
        try await require(next.value == 22, "Old completion settled or cleared the replacement")
        try await require(nextLog.entries == ["10", "20", "5"], "Old progress leaked into the replacement or values were rewritten")
        await oldConsumer.open()
        await oldExited.wait()
        try await require(oldLog.entries == ["1"], "Cancelled generation still delivered new progress")
        let cachedLog = LocalE5PreparationLog()
        let cached = try await preparation.prepare(requestId: "cached", total: 100, onProgress: { completed, total in
            await cachedLog.append("\(completed)/\(total)")
        }, load: { _ in throw Failure.assertion("Cached preparation unexpectedly loaded again") })
        try require(cached == 22, "Cancelled preparation replaced the cached value")
        try await require(cachedLog.entries == ["100/100"], "Cached progress did not drain before completion")
    }

    private static func registered(_ count: Int, preparation: LocalE5Preparation<Int>) async {
        // Observe the actual subscription boundary, not a guessed amount of scheduler time.
        while await preparation.activeRequestCount != count {
            await Task.yield()
        }
    }

    private static func cancelled(_ task: Task<Int, Error>) async throws {
        guard case .failure(is CancellationError) = await task.result else { throw Failure.assertion("Cancellation did not settle the caller") }
    }

    private static func require(_ condition: Bool, _ message: String) throws {
        if !condition {
            throw Failure.assertion(message)
        }
    }
}
