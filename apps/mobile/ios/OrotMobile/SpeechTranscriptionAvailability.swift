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
            #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
                NSLog(
                    "OROT_SPEECH_DIAGNOSTIC modules os=%@ speech_locale=%@ speech_hardware_available=%@",
                    ProcessInfo.processInfo.operatingSystemVersionString,
                    speechLocale?.identifier ?? "none",
                    SpeechTranscriber.isAvailable ? "true" : "false",
                )
            #endif
            if let speechLocale, SpeechTranscriber.isAvailable {
                let transcriber = SpeechTranscriptionAnalyzer.makeTimeIndexedTranscriber(locale: speechLocale)
                let configuration = await configurationAvailability(
                    assetStatus: AssetInventory.status(forModules: [transcriber]),
                    engine: .speechTranscriber,
                    locale: speechLocale.identifier,
                    hasCompatibleFormat: { await !(transcriber.availableCompatibleAudioFormats).isEmpty },
                )
                return useLegacyFallbackIfNeeded(for: configuration)
            }

            let dictationLocale = await DictationTranscriber.supportedLocale(equivalentTo: requestedLocale)
            #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
                // Read the legacy engine without requesting permission to check whether a local fallback exists.
                let legacyRecognizer = SFSpeechRecognizer(locale: requestedLocale)
                NSLog(
                    "OROT_SPEECH_DIAGNOSTIC modules dictation_locale=%@ legacy_locale=%@ legacy_on_device=%@ legacy_available=%@ speech_authorization=%@",
                    dictationLocale?.identifier ?? "none",
                    legacyRecognizer?.locale.identifier ?? "none",
                    legacyRecognizer.map { $0.supportsOnDeviceRecognition ? "true" : "false" } ?? "none",
                    legacyRecognizer.map { $0.isAvailable ? "true" : "false" } ?? "none",
                    String(describing: SFSpeechRecognizer.authorizationStatus()),
                )
            #endif
            if let dictationLocale {
                let transcriber = DictationTranscriber(locale: dictationLocale, preset: .timeIndexedLongDictation)
                let configuration = await configurationAvailability(
                    assetStatus: AssetInventory.status(forModules: [transcriber]),
                    engine: .dictationTranscriber,
                    locale: dictationLocale.identifier,
                    hasCompatibleFormat: { await !(transcriber.availableCompatibleAudioFormats).isEmpty },
                )
                return useLegacyFallbackIfNeeded(for: configuration)
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

    /// Keep a legacy permission denial distinct from the model failure that started fallback.
    static func permissionFailureDuringLegacyFallback(
        for legacy: SpeechTranscriptionAvailabilityResult,
    ) -> SpeechTranscriptionFailure? {
        switch legacy.status {
        case .permissionDenied:
            SpeechTranscriptionFailure("PERMISSION_DENIED", "Speech recognition permission was denied.")
        case .permissionRestricted:
            SpeechTranscriptionFailure("PERMISSION_RESTRICTED", "Speech recognition is restricted on this device.")
        default:
            nil
        }
    }

    static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    static func legacyAvailability() -> SpeechTranscriptionAvailabilityResult {
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

    /// Use the legacy API only when it advertises local recognition; its request also requires on-device processing.
    private static func useLegacyFallbackIfNeeded(
        for configuration: SpeechTranscriptionAvailabilityResult,
    ) -> SpeechTranscriptionAvailabilityResult {
        guard shouldSelectLegacyFallback(for: configuration.status) else { return configuration }
        let legacy = legacyAvailability()
        return selectLegacyFallback(configuration: configuration, legacy: legacy)
    }

    static func shouldSelectLegacyFallback(for status: SpeechTranscriptionStatus) -> Bool {
        status == .modelUnavailable || status == .unsupportedDevice
    }

    static func selectLegacyFallback(
        configuration: SpeechTranscriptionAvailabilityResult,
        legacy: SpeechTranscriptionAvailabilityResult,
    ) -> SpeechTranscriptionAvailabilityResult {
        guard shouldSelectLegacyFallback(for: configuration.status),
              legacy.engine == .onDeviceSpeechRecognizer,
              legacy.status != .unsupportedDevice
        else {
            return configuration
        }
        return legacy
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
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            NSLog(
                "OROT_SPEECH_DIAGNOSTIC availability engine=%@ locale=%@ asset_status=%@ result=%@ model_installed=%@",
                engine.rawValue,
                locale,
                String(describing: assetStatus),
                status.rawValue,
                assetStatus == .installed ? "true" : "false",
            )
        #endif
        return SpeechTranscriptionAvailabilityResult(
            status: status, engine: engine, locale: locale, modelInstalled: assetStatus == .installed,
        )
    }
}

@available(iOS 26.0, *)
enum SpeechTranscriptionAssetInstallation {
    /// Asset installation can return before the model is ready, so analysis starts only after `.installed`.
    static func withInstalledAssets<Result>(
        prepare: () async throws -> AssetInventory.Status,
        analyze: () async throws -> Result,
    ) async throws -> Result {
        do {
            try Task.checkCancellation()
            let status = try await prepare()
            try Task.checkCancellation()
            guard status == .installed else {
                throw SpeechTranscriptionFailure(
                    "MODEL_INSTALL_FAILED",
                    "Apple did not install the Korean on-device speech model.",
                )
            }
            try Task.checkCancellation()
        } catch {
            if let failure = error as? SpeechTranscriptionFailure,
               failure.code == "TRANSCRIPTION_CANCELLED" || failure.code == "TRANSCRIPTION_TIMEOUT"
            {
                throw failure
            }
            if error is CancellationError {
                throw SpeechTranscriptionDeadline.cancelledFailure()
            }
            throw SpeechTranscriptionFailure(
                "MODEL_INSTALL_FAILED",
                "The Korean on-device speech model could not be installed.",
            )
        }

        return try await analyze()
    }
}
