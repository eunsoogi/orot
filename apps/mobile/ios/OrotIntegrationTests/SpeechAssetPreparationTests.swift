import Foundation
@testable import Orot
import Speech
import XCTest

/// Installs the actual selected Korean module before recognition. This stage uses no audio or transcript and cannot stand in for a Speech fixture result.
final class SpeechAssetPreparationTests: OrotFailFastTestCase {
    func testSelectedKoreanAssetsInstallWithoutRecognizingAnyFixture() async throws {
        guard #available(iOS 26.0, *) else {
            XCTFail("The pinned Speech destination requires the iOS 26 asset boundary")
            return
        }
        let started = ProcessInfo.processInfo.systemUptime
        let trace = PreparationTrace()
        // Cold asset downloads have a separate setup budget; recognition retains the production 120-second deadline.
        let result: [String: Any]
        do {
            result = try await SpeechTranscriptionDeadline.run(timeoutNanoseconds: 180_000_000_000) {
                try await Self.installSelectedAssets(trace: trace)
            }
        } catch {
            // Keep the first failure and the last unfinished public API even when cancellation returns before that API does.
            let failure = trace.snapshot().merging(["error": String(describing: error)]) { _, new in new }
            try attach(failure, named: "selected-korean-assets-preparation-failure")
            throw error
        }
        let receipt = result.merging(trace.snapshot()) { _, new in new }
            .merging(["elapsedMs": (ProcessInfo.processInfo.systemUptime - started) * 1000]) { _, new in new }
        try attach(receipt, named: "selected-korean-assets-without-recognition")
        XCTAssertEqual(result["statusAfter"] as? String, "installed")
        XCTAssertEqual(result["bestFormatAvailable"] as? Bool, true)
        XCTAssertGreaterThan(try XCTUnwrap(result["compatibleFormatCount"] as? Int), 0)
        XCTAssertEqual(result["inputAudioUsed"] as? Bool, false)
    }

    @available(iOS 26.0, *)
    private static func installSelectedAssets(trace: PreparationTrace) async throws -> [String: Any] {
        let selected = await trace.measure("availability") { await SpeechTranscriptionEngine.availability(language: "ko-KR") }
        guard selected.status == .available else {
            throw SpeechTranscriptionFailure("SPEECH_PREPARATION_UNAVAILABLE", "The selected Korean Speech module is unavailable")
        }
        let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
        let module: any SpeechModule
        switch selected.engine {
        case .speechTranscriber:
            let candidate = await trace.measure("speech-supported-locale") { await SpeechTranscriber.supportedLocale(equivalentTo: locale) }
            let supported = try XCTUnwrap(candidate)
            module = SpeechTranscriptionAnalyzer.makeTimeIndexedTranscriber(locale: supported)
        case .dictationTranscriber:
            let candidate = await trace.measure("dictation-supported-locale") { await DictationTranscriber.supportedLocale(equivalentTo: locale) }
            let supported = try XCTUnwrap(candidate)
            module = DictationTranscriber(locale: supported, preset: .timeIndexedLongDictation)
        default:
            throw SpeechTranscriptionFailure("SPEECH_PREPARATION_UNSUPPORTED", "The pinned destination did not select an analyzer module")
        }
        let before = await trace.measure("status-before") { await AssetInventory.status(forModules: [module]) }
        try Task.checkCancellation()
        let installation = try await trace.measure("installation-request") { try await AssetInventory.assetInstallationRequest(supporting: [module]) }
        if let installation {
            try await trace.measure("download-and-install") { try await installation.downloadAndInstall() }
        }
        try Task.checkCancellation()
        let after = await trace.measure("status-after") { await AssetInventory.status(forModules: [module]) }
        let formats = await trace.measure("compatible-formats") { await module.availableCompatibleAudioFormats }
        let best = await trace.measure("best-format") { await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) }
        return [
            "engine": selected.engine.rawValue, "locale": selected.locale,
            "statusBefore": String(describing: before), "statusAfter": String(describing: after),
            "installationRequestPresent": installation != nil, "compatibleFormatCount": formats.count,
            "bestFormatAvailable": best != nil, "inputAudioUsed": false,
        ]
    }

    private func attach(_ value: [String: Any], named name: String) throws {
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: value), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Test-only timing uses monotonic elapsed milliseconds and contains no audio, transcript or user data.
    /// The deadline task and asset operation can finish independently, so a lock protects the failure snapshot.
    private final class PreparationTrace: @unchecked Sendable {
        private let lock = NSLock()
        private let started = ProcessInfo.processInfo.systemUptime
        private var lastStage = "not-started"
        private var events: [[String: Any]] = []

        func measure<Value>(_ name: String, operation: () async throws -> Value) async rethrows -> Value {
            mark(name, phase: "started")
            do {
                let value = try await operation()
                mark(name, phase: "finished")
                return value
            } catch {
                mark(name, phase: "failed")
                throw error
            }
        }

        func snapshot() -> [String: Any] {
            lock.withLock { ["lastStage": lastStage, "stages": events, "elapsedMs": elapsedMs] }
        }

        private var elapsedMs: Double {
            (ProcessInfo.processInfo.systemUptime - started) * 1000
        }

        private func mark(_ name: String, phase: String) {
            lock.withLock {
                lastStage = name + ":" + phase
                let elapsed = elapsedMs
                events.append(["stage": name, "phase": phase, "elapsedMs": elapsed])
                NSLog("OROT_SPEECH_PREPARATION stage=%@ phase=%@ elapsed_ms=%.3f", name, phase, elapsed)
            }
        }
    }
}
