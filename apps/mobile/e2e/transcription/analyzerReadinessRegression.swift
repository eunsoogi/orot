// Compile the Speech transcription sources and deadline regression file with the macOS 26 Speech SDK.
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
        await SpeechTranscriptionDeadlineRegression.run()
        print("PASS: readiness, asset states, preparation failure, cancellation, deadlines, and callback completion")
    }

    @available(macOS 26.0, *)
    private static func installedAssetsAllowAnalysis() async {
        let calls = AnalysisCallCounter()
        let result = try! await SpeechTranscriptionAssetInstallation.withInstalledAssets(
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
        // Cancellation has its own terminal code so it remains distinct from unavailable model assets.
        await expectPreparationFailure(
            "cancelled installation request",
            expectedCode: "TRANSCRIPTION_CANCELLED",
        ) {
            throw CancellationError()
        }
    }

    @available(macOS 26.0, *)
    private static func cancellationAfterRequestStopsBeforeAnalysis() async {
        let gate = PreparationGate()
        let calls = AnalysisCallCounter()
        let operation = Task {
            try await SpeechTranscriptionAssetInstallation.withInstalledAssets(
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
            require(failure.code == "TRANSCRIPTION_CANCELLED", "Cancelled preparation lost its cancellation result")
        } catch {
            fatalError("Cancelled preparation returned an unexpected error: \(error)")
        }
        let analysisCount = await calls.count
        require(analysisCount == 0, "Analysis started after preparation was cancelled")
    }

    @available(macOS 26.0, *)
    private static func expectPreparationFailure(
        _ label: String,
        expectedCode: String = "MODEL_INSTALL_FAILED",
        prepare: () async throws -> AssetInventory.Status,
    ) async {
        let calls = AnalysisCallCounter()
        do {
            _ = try await SpeechTranscriptionAssetInstallation.withInstalledAssets(
                prepare: prepare,
                analyze: { await calls.record(); return "unexpected analysis" },
            )
            fatalError("\(label) unexpectedly started analysis")
        } catch let failure as SpeechTranscriptionFailure {
            require(failure.code == expectedCode, "\(label) returned an unexpected failure: \(failure.code)")
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

actor AnalysisCallCounter {
    private(set) var count = 0

    func record() {
        count += 1
    }
}

@available(macOS 26.0, *)
actor PreparationGate {
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
