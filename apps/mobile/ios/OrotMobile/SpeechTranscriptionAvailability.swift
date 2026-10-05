import Foundation
import Speech

enum SpeechTranscriptionAvailability {
    static func check(language: String) async -> SpeechTranscriptionAvailabilityResult {
        guard SpeechTranscriptionLanguage.isSupportedRequest(language) else {
            return .failure(.unsupportedLanguage, locale: language)
        }

        var speechTranscriberSupportsLocale = false
        if #available(iOS 26.0, *) {
            // Apple support varies by OS, model assets, and device; query the current device instead of hard-coding Korean support.
            let requestedLocale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
            let speechLocale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale)
            speechTranscriberSupportsLocale = speechLocale != nil
            if let speechLocale, SpeechTranscriber.isAvailable {
                let transcriber = SpeechTranscriptionAnalyzer.makeTimeIndexedTranscriber(locale: speechLocale)
                return await configurationAvailability(
                    assetStatus: AssetInventory.status(forModules: [transcriber]),
                    engine: .speechTranscriber,
                    locale: speechLocale.identifier,
                    hasCompatibleFormat: { await !(transcriber.availableCompatibleAudioFormats).isEmpty },
                )
            }

            if let dictationLocale = await DictationTranscriber.supportedLocale(equivalentTo: requestedLocale) {
                let transcriber = DictationTranscriber(locale: dictationLocale, preset: .timeIndexedLongDictation)
                return await configurationAvailability(
                    assetStatus: AssetInventory.status(forModules: [transcriber]),
                    engine: .dictationTranscriber,
                    locale: dictationLocale.identifier,
                    hasCompatibleFormat: { await !(transcriber.availableCompatibleAudioFormats).isEmpty },
                )
            }
        }

        let legacy = legacyAvailability()
        if legacy.status != .unsupportedLanguage {
            return legacy
        }
        if speechTranscriberSupportsLocale {
            return .failure(.unsupportedDevice, locale: SpeechTranscriptionLanguage.localeIdentifier)
        }
        return legacy
    }

    static func authorizationStatus() -> SFSpeechRecognizerAuthorizationStatus {
        SFSpeechRecognizer.authorizationStatus()
    }

    static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private static func legacyAvailability() -> SpeechTranscriptionAvailabilityResult {
        let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            return .failure(.unsupportedLanguage, locale: locale.identifier)
        }
        guard recognizer.supportsOnDeviceRecognition else {
            return .failure(.unsupportedDevice, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
        }
        guard recognizer.isAvailable else {
            return .failure(.recognizerUnavailable, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
        }

        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            return SpeechTranscriptionAvailabilityResult(
                status: .available,
                engine: .onDeviceSpeechRecognizer,
                locale: locale.identifier,
                modelInstalled: nil,
            )
        case .notDetermined:
            return .failure(.permissionNotDetermined, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
        case .denied:
            return .failure(.permissionDenied, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
        case .restricted:
            return .failure(.permissionRestricted, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
        @unknown default:
            return .failure(.recognizerUnavailable, locale: locale.identifier, engine: .onDeviceSpeechRecognizer)
        }
    }

    @available(iOS 26.0, *)
    static func configurationAvailability(
        assetStatus: AssetInventory.Status,
        engine: SpeechTranscriptionEngineKind,
        locale: String,
        hasCompatibleFormat: () async -> Bool,
    ) async -> SpeechTranscriptionAvailabilityResult {
        let status: SpeechTranscriptionStatus = switch assetStatus {
        case .supported, .downloading:
            // A locale can be listed as installed while this module configuration still needs assets.
            // Let the explicit transcription action reach the analyzer's installation request.
            .available
        case .installed:
            await hasCompatibleFormat() ? .available : .modelUnavailable
        case .unsupported:
            .unsupportedDevice
        @unknown default:
            .modelUnavailable
        }
        return SpeechTranscriptionAvailabilityResult(
            status: status, engine: engine, locale: locale, modelInstalled: assetStatus == .installed,
        )
    }
}
