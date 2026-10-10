import AVFoundation
import Foundation
import Speech

@available(iOS 26.0, *)
enum SpeechTranscriptionAnalyzer {
    static func transcribe(
        _ file: SpeechTranscriptionAudioFile,
        allowUnverifiedProtectionForSyntheticFixture: Bool,
    ) async throws -> [SpeechTranscriptionSegment] {
        let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
        guard let supportedLocale = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
            throw SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Apple SpeechTranscriber does not support Korean on this device.")
        }

        // Enable source audio ranges without requesting alternatives or provisional results.
        let transcriber = makeTimeIndexedTranscriber(locale: supportedLocale)
        return try await SpeechTranscriptionAssetInstallation.withInstalledAssets(
            prepare: { try await installAssets(for: transcriber, engine: "speech_transcriber") },
            analyze: {
                try await analyze(
                    file,
                    module: transcriber,
                    allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture,
                    collectResults: { try await collectResults(from: transcriber, duration: file.durationSeconds) },
                )
            },
        )
    }

    static func transcribeWithDictation(
        _ file: SpeechTranscriptionAudioFile,
        allowUnverifiedProtectionForSyntheticFixture: Bool,
    ) async throws -> [SpeechTranscriptionSegment] {
        let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
        guard let supportedLocale = await DictationTranscriber.supportedLocale(equivalentTo: locale) else {
            throw SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Apple DictationTranscriber does not support Korean on this device.")
        }

        // Consultation files can exceed a minute, and evidence links need the source audio time range.
        let transcriber = DictationTranscriber(locale: supportedLocale, preset: .timeIndexedLongDictation)
        return try await SpeechTranscriptionAssetInstallation.withInstalledAssets(
            prepare: { try await installAssets(for: transcriber, engine: "dictation_transcriber") },
            analyze: {
                try await analyze(
                    file,
                    module: transcriber,
                    allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture,
                    collectResults: { try await collectDictationResults(from: transcriber, duration: file.durationSeconds) },
                )
            },
        )
    }

    static func makeTimeIndexedTranscriber(locale: Locale) -> SpeechTranscriber {
        let preset = SpeechTranscriber.Preset.timeIndexedTranscriptionWithAlternatives
        return SpeechTranscriber(
            locale: locale,
            transcriptionOptions: preset.transcriptionOptions,
            reportingOptions: preset.reportingOptions.subtracting([.alternativeTranscriptions]),
            attributeOptions: preset.attributeOptions,
        )
    }

    /// Capture both installation snapshots for diagnostics so analysis can require the `.installed` postcondition.
    private static func installAssets(for module: any SpeechModule, engine: String) async throws -> AssetInventory.Status {
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            let startedAt = Date()
            let statusBefore = await AssetInventory.status(forModules: [module])
            let reservationsBefore = await AssetInventory.reservedLocales
            var requestNilResult = "not_returned"
            var downloadWasCalled = false
        #endif

        let statusAfter: AssetInventory.Status
        do {
            try Task.checkCancellation()
            let installation = try await AssetInventory.assetInstallationRequest(supporting: [module])
            if let installation {
                #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
                    requestNilResult = "false"
                    downloadWasCalled = true
                #endif
                try await installation.downloadAndInstall()
            } else {
                #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
                    requestNilResult = "true"
                #endif
            }
            // The async request can return while a later system download attempt is still pending.
            try Task.checkCancellation()
            statusAfter = await AssetInventory.status(forModules: [module])
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
            #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
                let statusAfter = await AssetInventory.status(forModules: [module])
                let reservationsAfter = await AssetInventory.reservedLocales
                let nativeError = error as NSError
                NSLog(
                    "OROT_SPEECH_DIAGNOSTIC install engine=%@ status_before=%@ request_nil=%@ download_called=%@ status_after=%@ reservations_before=%@ reservations_after=%@ elapsed_ms=%.1f error_domain=%@ error_code=%ld",
                    engine,
                    String(describing: statusBefore),
                    requestNilResult,
                    downloadWasCalled ? "true" : "false",
                    String(describing: statusAfter),
                    reservationsBefore.map(\.identifier).joined(separator: ","),
                    reservationsAfter.map(\.identifier).joined(separator: ","),
                    Date().timeIntervalSince(startedAt) * 1000,
                    nativeError.domain,
                    nativeError.code,
                )
            #endif
            throw SpeechTranscriptionFailure("MODEL_INSTALL_FAILED", "The Korean on-device speech model could not be installed.")
        }

        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            let compatibleFormats = await module.availableCompatibleAudioFormats
            let bestAvailableFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])
            let reservationsAfter = await AssetInventory.reservedLocales
            let formatSummary = compatibleFormats.map { "\($0.sampleRate)Hz/\($0.channelCount)ch" }.joined(separator: ",")
            NSLog(
                "OROT_SPEECH_DIAGNOSTIC install engine=%@ status_before=%@ request_nil=%@ download_called=%@ status_after=%@ compatible_format_count=%ld compatible_formats=%@ best_format_available=%@ reservations_before=%@ reservations_after=%@ elapsed_ms=%.1f",
                engine,
                String(describing: statusBefore),
                requestNilResult,
                downloadWasCalled ? "true" : "false",
                String(describing: statusAfter),
                compatibleFormats.count,
                formatSummary,
                bestAvailableFormat == nil ? "false" : "true",
                reservationsBefore.map(\.identifier).joined(separator: ","),
                reservationsAfter.map(\.identifier).joined(separator: ","),
                Date().timeIntervalSince(startedAt) * 1000,
            )
        #endif

        return statusAfter
    }

    private static func analyze(
        _ file: SpeechTranscriptionAudioFile,
        module: any SpeechModule,
        allowUnverifiedProtectionForSyntheticFixture: Bool,
        collectResults: @escaping @Sendable () async throws -> [SpeechTranscriptionSegment],
    ) async throws -> [SpeechTranscriptionSegment] {
        let bestAvailableFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])
        let compatibleFormats = await module.availableCompatibleAudioFormats
        guard let supportedFormat = bestAvailableFormat ?? compatibleFormats.first else {
            throw SpeechTranscriptionFailure("MODEL_UNAVAILABLE", "Apple has no installed audio format for this on-device speech model.")
        }

        return try await SpeechTranscriptionAudioStore.withAnalyzerCompatibleAudio(
            file,
            format: supportedFormat,
            allowUnverifiedProtectionForSyntheticFixture: allowUnverifiedProtectionForSyntheticFixture,
        ) { compatibleFile in
            let audioFile = try AVAudioFile(forReading: compatibleFile.url)
            let analyzer = SpeechAnalyzer(modules: [module])
            do {
                return try await SpeechTranscriptionTaskCancellation.withAnalyzerCancellation(
                    start: { try await analyzer.start(inputAudioFile: audioFile, finishAfterFile: true) },
                    collectResults: collectResults,
                    cancel: { await analyzer.cancelAndFinishNow() },
                )
            } catch {
                if let failure = error as? SpeechTranscriptionFailure,
                   failure.code == "TRANSCRIPTION_CANCELLED" || failure.code == "TRANSCRIPTION_TIMEOUT"
                {
                    throw failure
                }
                if error is CancellationError {
                    throw SpeechTranscriptionDeadline.cancelledFailure()
                }
                throw SpeechTranscriptionFailure("SPEECH_RECOGNITION_FAILED", error.localizedDescription)
            }
        }
    }

    private static func collectResults(
        from transcriber: SpeechTranscriber,
        duration: Double,
    ) async throws -> [SpeechTranscriptionSegment] {
        var segments: [SpeechTranscriptionSegment] = []
        for try await result in transcriber.results {
            let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty {
                continue
            }
            let start = result.range.start.seconds
            let end = CMTimeRangeGetEnd(result.range).seconds
            try validate(start: start, end: end, duration: duration, previous: segments.last)
            segments.append(SpeechTranscriptionSegment(startSeconds: start, endSeconds: end, text: text))
        }
        return segments
    }

    private static func collectDictationResults(
        from transcriber: DictationTranscriber,
        duration: Double,
    ) async throws -> [SpeechTranscriptionSegment] {
        var segments: [SpeechTranscriptionSegment] = []
        for try await result in transcriber.results {
            let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty {
                continue
            }
            let start = result.range.start.seconds
            let end = CMTimeRangeGetEnd(result.range).seconds
            try validate(start: start, end: end, duration: duration, previous: segments.last)
            segments.append(SpeechTranscriptionSegment(startSeconds: start, endSeconds: end, text: text))
        }
        return segments
    }

    private static func validate(
        start: Double,
        end: Double,
        duration: Double,
        previous: SpeechTranscriptionSegment?,
    ) throws {
        guard start.isFinite, end.isFinite, start >= 0, end > start,
              end <= duration + 0.1, previous.map({ start >= $0.startSeconds }) ?? true
        else {
            throw SpeechTranscriptionFailure("INVALID_TIMESTAMP", "Apple Speech returned an invalid audio time range.")
        }
    }
}
