// Compile with SpeechTranscriptionAnalyzer.swift and SpeechTranscriptionTypes.swift using the macOS 26 Speech SDK.
// The analyzer-compatible audio store below is only a link-time stand-in; these checks never read audio or start SpeechAnalyzer.
import AVFoundation
import Foundation
import Speech

@main
struct SpeechAnalyzerReadinessRegression {
    @available(macOS 26.0, *)
    static func main() async {
        await installedAssetsAllowAnalysis()
        for status in [AssetInventory.Status.supported, .downloading, .unsupported] {
            await nonInstalledAssetsStopBeforeAnalysis(status)
        }
        await preparationFailureStopsBeforeAnalysis()
        await cancelledRequestStopsBeforeAnalysis()
        await cancellationAfterRequestStopsBeforeAnalysis()
        print("PASS: installed readiness, pending/unsupported states, preparation failure, and cancellation")
    }

    @available(macOS 26.0, *)
    private static func installedAssetsAllowAnalysis() async {
        let calls = AnalysisCallCounter()
        let result = try! await SpeechTranscriptionAnalyzer.withInstalledAssets(
            prepare: { .installed },
            analyze: { await calls.record(); return "analysis started" },
        )
        let analysisCount = await calls.count
        require(result == "analysis started" && analysisCount == 1, "Installed assets did not start analysis once")
    }

    @available(macOS 26.0, *)
    private static func nonInstalledAssetsStopBeforeAnalysis(_ status: AssetInventory.Status) async {
        await expectPreparationFailure("status \(status)") { status }
    }

    @available(macOS 26.0, *)
    private static func preparationFailureStopsBeforeAnalysis() async {
        await expectPreparationFailure("installation failure") {
            throw NSError(domain: "SpeechAnalyzerReadinessRegression", code: 1)
        }
    }

    @available(macOS 26.0, *)
    private static func cancelledRequestStopsBeforeAnalysis() async {
        await expectPreparationFailure("cancelled installation request") {
            throw CancellationError()
        }
    }

    @available(macOS 26.0, *)
    private static func cancellationAfterRequestStopsBeforeAnalysis() async {
        let gate = PreparationGate()
        let calls = AnalysisCallCounter()
        let operation = Task {
            try await SpeechTranscriptionAnalyzer.withInstalledAssets(
                prepare: { await gate.prepare() },
                analyze: { await calls.record(); return "unexpected analysis" },
            )
        }

        await gate.waitUntilStarted()
        operation.cancel()
        await gate.finishInstalledRequest()

        do {
            _ = try await operation.value
            fatalError("Cancelled preparation unexpectedly started analysis")
        } catch let failure as SpeechTranscriptionFailure {
            require(failure.code == "MODEL_INSTALL_FAILED", "Cancelled preparation lost its unavailable result")
        } catch {
            fatalError("Cancelled preparation returned an unexpected error: \(error)")
        }
        let analysisCount = await calls.count
        require(analysisCount == 0, "Analysis started after preparation was cancelled")
    }

    @available(macOS 26.0, *)
    private static func expectPreparationFailure(
        _ label: String,
        prepare: () async throws -> AssetInventory.Status,
    ) async {
        let calls = AnalysisCallCounter()
        do {
            _ = try await SpeechTranscriptionAnalyzer.withInstalledAssets(
                prepare: prepare,
                analyze: { await calls.record(); return "unexpected analysis" },
            )
            fatalError("\(label) unexpectedly started analysis")
        } catch let failure as SpeechTranscriptionFailure {
            require(failure.code == "MODEL_INSTALL_FAILED", "\(label) lost its unavailable result")
        } catch {
            fatalError("\(label) returned an unexpected error: \(error)")
        }
        let analysisCount = await calls.count
        require(analysisCount == 0, "Analysis started after \(label)")
    }

    private static func require(_ condition: Bool, _ message: String) {
        guard condition else { fatalError(message) }
    }
}

private actor AnalysisCallCounter {
    private(set) var count = 0

    func record() {
        count += 1
    }
}

@available(macOS 26.0, *)
private actor PreparationGate {
    private var hasStarted = false
    private var statusContinuation: CheckedContinuation<AssetInventory.Status, Never>?
    private var startContinuation: CheckedContinuation<Void, Never>?

    /// Hold the request after it starts so the test can cancel before returning an installed status.
    func prepare() async -> AssetInventory.Status {
        await withCheckedContinuation { continuation in
            statusContinuation = continuation
            hasStarted = true
            startContinuation?.resume()
            startContinuation = nil
        }
    }

    func waitUntilStarted() async {
        guard !hasStarted else { return }
        await withCheckedContinuation { startContinuation = $0 }
    }

    func finishInstalledRequest() {
        guard let statusContinuation else {
            fatalError("The prepared request was not waiting for its result")
        }
        self.statusContinuation = nil
        statusContinuation.resume(returning: .installed)
    }
}

/// The test injects all preparation and analysis work, so it never touches a recording or converts audio.
enum SpeechTranscriptionAudioStore {
    static func withAnalyzerCompatibleAudio<T>(
        _ file: SpeechTranscriptionAudioFile,
        format _: AVAudioFormat,
        allowUnverifiedProtectionForSyntheticFixture _: Bool,
        operation: (SpeechTranscriptionAudioFile) async throws -> T,
    ) async throws -> T {
        try await operation(file)
    }
}
