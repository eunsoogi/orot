import Foundation
@testable import Orot
import Speech
import XCTest

/// Installs the actual selected Korean module before recognition. This stage uses no audio or transcript and cannot stand in for a Speech fixture result.
final class SpeechAssetPreparationTests: XCTestCase {
    func testSelectedKoreanAssetsInstallWithoutRecognizingAnyFixture() async throws {
        guard #available(iOS 26.0, *) else {
            XCTFail("The pinned Speech destination requires the iOS 26 native asset boundary")
            return
        }
        let started = ProcessInfo.processInfo.systemUptime
        // Cold asset downloads have a separate setup budget; recognition retains the production 120-second deadline.
        let result = try await SpeechTranscriptionDeadline.run(timeoutNanoseconds: 180_000_000_000) {
            try await Self.installSelectedAssets()
        }
        let receipt = result.merging(["elapsedMs": (ProcessInfo.processInfo.systemUptime - started) * 1000]) { _, new in new }
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "selected-korean-assets-without-recognition"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(result["statusAfter"] as? String, "installed")
        XCTAssertEqual(result["bestFormatAvailable"] as? Bool, true)
        XCTAssertGreaterThan(try XCTUnwrap(result["compatibleFormatCount"] as? Int), 0)
        XCTAssertEqual(result["inputAudioUsed"] as? Bool, false)
    }

    @available(iOS 26.0, *)
    private static func installSelectedAssets() async throws -> [String: Any] {
        let selected = await SpeechTranscriptionEngine.availability(language: "ko-KR")
        guard selected.status == .available else {
            throw SpeechTranscriptionFailure("SPEECH_PREPARATION_UNAVAILABLE", "The selected native Korean module is unavailable")
        }
        let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
        let module: any SpeechModule
        switch selected.engine {
        case .speechTranscriber:
            let candidate = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
            let supported = try XCTUnwrap(candidate)
            module = SpeechTranscriptionAnalyzer.makeTimeIndexedTranscriber(locale: supported)
        case .dictationTranscriber:
            let candidate = await DictationTranscriber.supportedLocale(equivalentTo: locale)
            let supported = try XCTUnwrap(candidate)
            module = DictationTranscriber(locale: supported, preset: .timeIndexedLongDictation)
        default:
            throw SpeechTranscriptionFailure("SPEECH_PREPARATION_UNSUPPORTED", "The pinned destination did not select an analyzer module")
        }
        let before = await AssetInventory.status(forModules: [module])
        try Task.checkCancellation()
        let installation = try await AssetInventory.assetInstallationRequest(supporting: [module])
        if let installation {
            try await installation.downloadAndInstall()
        }
        try Task.checkCancellation()
        let after = await AssetInventory.status(forModules: [module])
        let formats = await module.availableCompatibleAudioFormats
        let best = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])
        return [
            "engine": selected.engine.rawValue, "locale": selected.locale,
            "statusBefore": String(describing: before), "statusAfter": String(describing: after),
            "installationRequestPresent": installation != nil, "compatibleFormatCount": formats.count,
            "bestFormatAvailable": best != nil, "inputAudioUsed": false,
        ]
    }
}
