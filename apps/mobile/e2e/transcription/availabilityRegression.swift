// Compile alongside production SpeechTranscriptionAvailability.swift and SpeechTranscriptionTypes.swift.
// These deterministic routing checks do not establish device model availability or transcription.
import Foundation
import Speech

/// Availability's analyzer dependency only constructs a module. No analyzer execution is mocked here.
@available(macOS 26.0, *)
enum SpeechTranscriptionAnalyzer {
    static func makeTimeIndexedTranscriber(locale: Locale) -> SpeechTranscriber {
        SpeechTranscriber(locale: locale, preset: .timeIndexedTranscriptionWithAlternatives)
    }
}

@main
struct AvailabilityRegression {
    static func main() async {
        for engine in [SpeechTranscriptionEngineKind.speechTranscriber, .dictationTranscriber] {
            for assetStatus in [AssetInventory.Status.supported, .downloading] {
                let result = await SpeechTranscriptionAvailability.configurationAvailability(
                    assetStatus: assetStatus, engine: engine, locale: "ko_KR",
                    hasCompatibleFormat: { fatalError("Pending assets must reach installation without a format query") },
                )
                require(result.status == .available && result.modelInstalled == false, "Pending assets blocked installation")
                require(result.engine == engine && result.locale == "ko_KR", "Engine or locale changed")
            }
            let unsupported = await SpeechTranscriptionAvailability.configurationAvailability(
                assetStatus: .unsupported, engine: engine, locale: "ko_KR",
                hasCompatibleFormat: { fatalError("Unsupported configuration queried formats") },
            )
            require(unsupported.status == .unsupportedDevice && unsupported.modelInstalled == false,
                    "Unsupported configuration was treated as installable")
            for hasFormat in [false, true] {
                var queries = 0
                let result = await SpeechTranscriptionAvailability.configurationAvailability(
                    assetStatus: .installed, engine: engine, locale: "ko_KR",
                    hasCompatibleFormat: { queries += 1; return hasFormat },
                )
                require(queries == 1 && result.modelInstalled == true, "Installed assets were not checked")
                require(result.status == (hasFormat ? .available : .modelUnavailable), "Installed format state was ignored")
            }
        }
        let unsupportedLanguage = await SpeechTranscriptionAvailability.check(language: "en-US")
        require(unsupportedLanguage.status == .unsupportedLanguage, "Unsupported language reached native model queries")

        let missingFormat = SpeechTranscriptionAvailabilityResult.failure(.modelUnavailable, locale: "ko_KR")
        let localLegacy = SpeechTranscriptionAvailabilityResult(
            status: .available, engine: .onDeviceSpeechRecognizer, locale: "ko_KR", modelInstalled: nil,
        )
        let selectedFallback = SpeechTranscriptionAvailability.selectLegacyFallback(
            configuration: missingFormat, legacy: localLegacy,
        )
        require(selectedFallback.engine == .onDeviceSpeechRecognizer, "Missing module format did not select local fallback")
        let remoteOnlyLegacy = SpeechTranscriptionAvailabilityResult.failure(.unsupportedDevice, locale: "ko_KR")
        let keptUnsupported = SpeechTranscriptionAvailability.selectLegacyFallback(
            configuration: missingFormat, legacy: remoteOnlyLegacy,
        )
        require(keptUnsupported.status == .modelUnavailable, "Remote-only fallback replaced the model failure")
        let deniedLegacy = SpeechTranscriptionAvailabilityResult.failure(
            .permissionDenied, locale: "ko_KR", engine: .onDeviceSpeechRecognizer,
        )
        let restrictedLegacy = SpeechTranscriptionAvailabilityResult.failure(
            .permissionRestricted, locale: "ko_KR", engine: .onDeviceSpeechRecognizer,
        )
        require(
            SpeechTranscriptionAvailability.permissionFailureDuringLegacyFallback(for: deniedLegacy)?.code == "PERMISSION_DENIED",
            "Existing denied permission was hidden by model failure",
        )
        require(
            SpeechTranscriptionAvailability.permissionFailureDuringLegacyFallback(for: restrictedLegacy)?.code == "PERMISSION_RESTRICTED",
            "Existing restricted permission was hidden by model failure",
        )
        require(!SpeechTranscriptionAvailability.shouldSelectLegacyFallback(for: .unsupportedLanguage),
                "Unsupported request language selected a fallback")

        print("PASS: 10 configuration routes, local fallback permission errors, and unsupported-language guard")
    }

    static func require(_ condition: Bool, _ message: String) {
        if !condition {
            fatalError(message)
        }
    }
}
