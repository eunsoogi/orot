import Foundation
import Speech

enum SpeechTranscriptionEngine {
    static func availability(language: String) async -> SpeechTranscriptionAvailabilityResult {
        await SpeechTranscriptionAvailability.check(language: language)
    }

    static func transcribe(_ request: [String: Any]) async throws -> [String: Any] {
        guard let language = request["language"] as? String,
              SpeechTranscriptionLanguage.isSupportedRequest(language)
        else {
            throw SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Only Korean transcription is supported.")
        }
        guard let base64 = request["audioBase64"] as? String,
              let mediaType = request["mediaType"] as? String
        else {
            throw SpeechTranscriptionFailure("INVALID_AUDIO", "Audio data and media type are required.")
        }

        var available = await availability(language: language)
        if available.status == .permissionNotDetermined {
            // Ask only after the caller starts transcription; availability checks stay read-only.
            let permission = await SpeechTranscriptionAvailability.requestAuthorization()
            guard permission == .authorized else {
                let status: SpeechTranscriptionStatus = permission == .restricted ? .permissionRestricted : .permissionDenied
                throw failure(for: .failure(status, locale: SpeechTranscriptionLanguage.localeIdentifier, engine: .onDeviceSpeechRecognizer))
            }
            available = await availability(language: language)
        }

        guard available.status == .available else {
            throw failure(for: available)
        }

        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            let isSyntheticFixture = request["syntheticFixture"] as? Bool == true
        #else
            let isSyntheticFixture = false
        #endif

        return try await SpeechTranscriptionAudioStore.withProtectedAudio(
            base64: base64,
            mediaType: mediaType,
            allowUnverifiedProtectionForSyntheticFixture: isSyntheticFixture,
        ) { file in
            let text: String
            let segments: [SpeechTranscriptionSegment]
            var selectedEngine = available.engine
            switch available.engine {
            case .speechTranscriber:
                guard #available(iOS 26.0, *) else {
                    throw SpeechTranscriptionFailure("UNSUPPORTED_DEVICE", "SpeechTranscriber requires iOS 26.")
                }
                do {
                    segments = try await SpeechTranscriptionAnalyzer.transcribe(
                        file,
                        allowUnverifiedProtectionForSyntheticFixture: isSyntheticFixture,
                    )
                    text = join(segments)
                } catch let error as SpeechTranscriptionFailure where error.code == "MODEL_UNAVAILABLE" {
                    // A usable legacy recognizer can keep processing local when a module has no compatible audio format.
                    (text, segments) = try await transcribeWithLegacyFallback(file, after: error)
                    selectedEngine = .onDeviceSpeechRecognizer
                }
            case .dictationTranscriber:
                guard #available(iOS 26.0, *) else {
                    throw SpeechTranscriptionFailure("UNSUPPORTED_DEVICE", "DictationTranscriber requires iOS 26.")
                }
                do {
                    segments = try await SpeechTranscriptionAnalyzer.transcribeWithDictation(
                        file,
                        allowUnverifiedProtectionForSyntheticFixture: isSyntheticFixture,
                    )
                    text = join(segments)
                } catch let error as SpeechTranscriptionFailure where error.code == "MODEL_UNAVAILABLE" {
                    (text, segments) = try await transcribeWithLegacyFallback(file, after: error)
                    selectedEngine = .onDeviceSpeechRecognizer
                }
            case .onDeviceSpeechRecognizer:
                // The legacy request is also pinned to local processing and cannot fall back to Apple servers.
                (text, segments) = try await SpeechTranscriptionLegacyRecognizer.transcribe(file)
            case .none:
                throw SpeechTranscriptionFailure("UNSUPPORTED_DEVICE", "No on-device Apple speech API is available.")
            }
            return [
                "text": text,
                "language": SpeechTranscriptionLanguage.localeIdentifier,
                "segments": segments.map(\.dictionary),
                "engine": selectedEngine.rawValue,
            ]
        }
    }

    private static func transcribeWithLegacyFallback(
        _ file: SpeechTranscriptionAudioFile,
        after modelFailure: SpeechTranscriptionFailure,
    ) async throws -> (String, [SpeechTranscriptionSegment]) {
        var legacy = SpeechTranscriptionAvailability.legacyAvailability()
        if legacy.status == .permissionNotDetermined {
            let permission = await SpeechTranscriptionAvailability.requestAuthorization()
            guard permission == .authorized else {
                let status: SpeechTranscriptionStatus = permission == .restricted ? .permissionRestricted : .permissionDenied
                throw failure(for: .failure(status, locale: SpeechTranscriptionLanguage.localeIdentifier, engine: .onDeviceSpeechRecognizer))
            }
            legacy = SpeechTranscriptionAvailability.legacyAvailability()
        }
        if let permissionFailure = SpeechTranscriptionAvailability.permissionFailureDuringLegacyFallback(for: legacy) {
            throw permissionFailure
        }
        guard legacy.status == .available else { throw modelFailure }
        return try await SpeechTranscriptionLegacyRecognizer.transcribe(file)
    }

    private static func failure(for availability: SpeechTranscriptionAvailabilityResult) -> SpeechTranscriptionFailure {
        switch availability.status {
        case .unsupportedLanguage:
            SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Apple on-device speech does not support Korean on this device.")
        case .unsupportedDevice:
            SpeechTranscriptionFailure("UNSUPPORTED_DEVICE", "Apple on-device speech is unavailable on this device.")
        case .modelUnavailable:
            SpeechTranscriptionFailure("MODEL_UNAVAILABLE", "The Korean on-device speech model is unavailable.")
        case .permissionDenied:
            SpeechTranscriptionFailure("PERMISSION_DENIED", "Speech recognition permission was denied.")
        case .permissionRestricted:
            SpeechTranscriptionFailure("PERMISSION_RESTRICTED", "Speech recognition is restricted on this device.")
        case .recognizerUnavailable:
            SpeechTranscriptionFailure("RECOGNIZER_UNAVAILABLE", "Apple on-device speech is temporarily unavailable.")
        case .permissionNotDetermined:
            SpeechTranscriptionFailure("PERMISSION_DENIED", "Speech recognition permission has not been granted.")
        case .available:
            SpeechTranscriptionFailure("SPEECH_RECOGNITION_FAILED", "The speech engine could not start.")
        }
    }

    private static func join(_ segments: [SpeechTranscriptionSegment]) -> String {
        segments.reduce(into: "") { text, segment in
            let piece = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !piece.isEmpty else { return }
            guard !text.isEmpty else { text = piece; return }
            let punctuation: Set<Character> = [",", ".", "!", "?", ";", ":", "，", "。", "！", "？", "、", ")", "]", "}", "〉", "》", "」", "』", "】", "”", "’", "\"", "'"]
            if !text.last!.isWhitespace, !piece.first!.isWhitespace, !punctuation.contains(piece.first!) {
                text.append(" ")
            }
            text.append(piece)
        }
    }
}
