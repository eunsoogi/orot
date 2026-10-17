import Foundation
#if canImport(Orot)
    @testable import Orot
#endif

/// Explicit gates hold producers and consumers independently; these regressions do not depend on download speed or sleeps.
actor LocalE5PreparationGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if opened {
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        opened = true
        let pending = waiters
        waiters.removeAll()
        pending.forEach { $0.resume() }
    }
}

actor LocalE5PreparationLog {
    private(set) var entries: [String] = []
    func append(_ value: String) {
        entries.append(value)
    }
}

/// Deliberately ignores cancellation until released, modeling a late callback or completion from a replaced preparation.
actor LocalE5PreparationLoader {
    let started = LocalE5PreparationGate()
    let released = LocalE5PreparationGate()
    let returning = LocalE5PreparationGate()
    private var progress: ((Int64, Int64) -> Void)?
    private(set) var invocations = 0

    func load(_ progress: @escaping (Int64, Int64) -> Void, value: Int, fails: Bool = false) async throws -> Int {
        invocations += 1
        self.progress = progress
        await started.open()
        await released.wait()
        await returning.open()
        if fails {
            throw LocalE5PreparationRegression.Failure.expectedLoaderFailure
        }
        return value
    }

    func emit(_ values: [Int64], total: Int64 = 4096) {
        values.forEach { progress?($0, total) }
    }
}
