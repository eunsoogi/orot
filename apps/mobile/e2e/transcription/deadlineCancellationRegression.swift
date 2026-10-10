import Foundation

/// Injected suspended operations prove terminal outcomes without recording audio or starting system transcription.
@available(macOS 26.0, *)
enum SpeechTranscriptionDeadlineRegression {
    static func run() async {
        await stalledPreparationReturnsAtDeadline()
        await stalledResultsCancelAnalyzerAtDeadline()
        await callbackCancellationResumesOnce()
    }

    private static func stalledPreparationReturnsAtDeadline() async {
        let gate = PreparationGate()
        let calls = AnalysisCallCounter()
        let request = Task {
            try await SpeechTranscriptionDeadline.run(timeoutNanoseconds: 100_000_000) {
                try await SpeechTranscriptionAssetInstallation.withInstalledAssets(
                    prepare: { await gate.prepare() },
                    analyze: { await calls.record(); return "unexpected analysis" },
                )
            }
        }

        await gate.waitUntilStarted()
        do {
            _ = try await request.value
            fatalError("A stalled asset request exceeded its deadline")
        } catch let failure as SpeechTranscriptionFailure {
            require(failure.code == "TRANSCRIPTION_TIMEOUT", "A stalled asset request returned the wrong terminal result")
        } catch {
            fatalError("A stalled asset request returned an unexpected error: \(error)")
        }
        await gate.finishInstalledRequest()
        let analysisCount = await calls.count
        require(analysisCount == 0, "Analysis started after the asset request deadline")
    }

    private static func stalledResultsCancelAnalyzerAtDeadline() async {
        let gate = AnalyzerResultGate()
        let request = Task {
            try await SpeechTranscriptionDeadline.run(timeoutNanoseconds: 100_000_000) {
                try await SpeechTranscriptionTaskCancellation.withAnalyzerCancellation(
                    start: {},
                    collectResults: { await gate.collect() },
                    cancel: { await gate.cancel() },
                )
            }
        }

        await gate.waitUntilStarted()
        do {
            _ = try await request.value
            fatalError("A stalled Speech result stream exceeded its deadline")
        } catch let failure as SpeechTranscriptionFailure {
            require(failure.code == "TRANSCRIPTION_TIMEOUT", "A stalled result stream returned the wrong terminal result")
        } catch {
            fatalError("A stalled result stream returned an unexpected error: \(error)")
        }
        await gate.waitUntilCancelled()
    }

    private static func callbackCancellationResumesOnce() async {
        let gate = SpeechTranscriptionContinuation<String>()
        let counter = CancellationCallCounter()
        gate.cancel()

        do {
            let _: String = try await withCheckedThrowingContinuation { continuation in
                gate.install(continuation)
                gate.attachCancellation { counter.record() }
                gate.complete(.success("late callback"))
            }
            fatalError("A cancelled callback bridge unexpectedly succeeded")
        } catch let failure as SpeechTranscriptionFailure {
            require(failure.code == "TRANSCRIPTION_CANCELLED", "The callback bridge lost its cancellation result")
        } catch {
            fatalError("The callback bridge returned an unexpected error: \(error)")
        }
        require(counter.count == 1, "Cancellation did not cancel the attached recognition task exactly once")
    }

    private static func require(_ condition: Bool, _ message: String) {
        guard condition else { fatalError(message) }
    }
}

@available(macOS 26.0, *)
private actor AnalyzerResultGate {
    private var started = false
    private var cancelled = false
    private var resultContinuation: CheckedContinuation<String, Never>?
    private var startContinuation: CheckedContinuation<Void, Never>?
    private var cancellationContinuation: CheckedContinuation<Void, Never>?

    /// Hold result iteration until the injected analyzer cancellation finishes it.
    func collect() async -> String {
        await withCheckedContinuation { continuation in
            resultContinuation = continuation
            started = true
            startContinuation?.resume()
            startContinuation = nil
        }
    }

    func cancel() {
        guard !cancelled else { return }
        cancelled = true
        resultContinuation?.resume(returning: "cancelled")
        resultContinuation = nil
        cancellationContinuation?.resume()
        cancellationContinuation = nil
    }

    func waitUntilStarted() async {
        guard !started else { return }
        await withCheckedContinuation { startContinuation = $0 }
    }

    func waitUntilCancelled() async {
        guard !cancelled else { return }
        await withCheckedContinuation { cancellationContinuation = $0 }
    }
}

private final class CancellationCallCounter {
    private let lock = NSLock()
    private var storedCount = 0

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return storedCount
    }

    func record() {
        lock.lock()
        storedCount += 1
        lock.unlock()
    }
}
