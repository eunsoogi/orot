import AVFoundation
import Foundation
import Speech

enum SpeechTranscriptionEngine {
    static func availability(language: String) async -> SpeechTranscriptionAvailabilityResult {
        await SpeechTranscriptionAvailability.check(language: language)
    }

    static func transcribe(_ request: [String: Any]) async throws -> [String: Any] {
        let language = try validatedLanguage(request)
        guard let base64 = request["audioBase64"] as? String,
              let mediaType = request["mediaType"] as? String
        else {
            throw SpeechTranscriptionFailure("INVALID_AUDIO", "Audio data and media type are required.")
        }
        let selected = try await availableEngine(language: language)
        let syntheticFixture = isSyntheticFixture(request)
        return try await SpeechTranscriptionAudioStore.withProtectedAudio(
            base64: base64,
            mediaType: mediaType,
            allowUnverifiedProtectionForSyntheticFixture: syntheticFixture,
        ) { file in
            try await transcribe(file, selected: selected, syntheticFixture: syntheticFixture)
        }
    }

    static func transcribeRecording(_ request: [String: Any]) async throws -> [String: Any] {
        let language = try validatedLanguage(request)
        guard let recordingID = request["recordingId"] as? String else {
            throw SpeechTranscriptionFailure("INVALID_AUDIO", "A saved recording identifier is required.")
        }
        let selected = try await availableEngine(language: language)
        let syntheticFixture = isSyntheticFixture(request)
        let file = try RecordingFileSecurity.protectedAudioFile(
            id: recordingID,
            allowUnverifiedProtectionForSimulator: syntheticFixture,
        )
        return try await transcribe(file, selected: selected, syntheticFixture: syntheticFixture)
    }

    private static func validatedLanguage(_ request: [String: Any]) throws -> String {
        guard let language = request["language"] as? String,
              SpeechTranscriptionLanguage.isSupportedRequest(language)
        else {
            throw SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Only Korean transcription is supported.")
        }
        return SpeechTranscriptionLanguage.localeIdentifier
    }

    private static func isSyntheticFixture(_ request: [String: Any]) -> Bool {
        #if OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST && targetEnvironment(simulator)
            return request["syntheticFixture"] as? Bool == true
        #else
            return false
        #endif
    }

    private static func availableEngine(language: String) async throws -> SpeechTranscriptionAvailabilityResult {
        var available = await availability(language: language)
        if available.status == .permissionNotDetermined {
            // Ask only after a user starts transcription; availability checks do not prompt.
            let permission = await SpeechTranscriptionAvailability.requestAuthorization()
            guard permission == .authorized else {
                let status: SpeechTranscriptionStatus = permission == .restricted ? .permissionRestricted : .permissionDenied
                throw failure(for: .failure(status, locale: language, engine: .onDeviceSpeechRecognizer))
            }
            available = await availability(language: language)
        }
        guard available.status == .available else { throw failure(for: available) }
        return available
    }

    private static func transcribe(
        _ file: SpeechTranscriptionAudioFile,
        selected available: SpeechTranscriptionAvailabilityResult,
        syntheticFixture: Bool,
    ) async throws -> [String: Any] {
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
                    allowUnverifiedProtectionForSyntheticFixture: syntheticFixture,
                )
                text = join(segments)
            } catch let error as SpeechTranscriptionFailure where error.code == "MODEL_UNAVAILABLE" {
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
                    allowUnverifiedProtectionForSyntheticFixture: syntheticFixture,
                )
                text = join(segments)
            } catch let error as SpeechTranscriptionFailure where error.code == "MODEL_UNAVAILABLE" {
                (text, segments) = try await transcribeWithLegacyFallback(file, after: error)
                selectedEngine = .onDeviceSpeechRecognizer
            }
        case .onDeviceSpeechRecognizer:
            (text, segments) = try await SpeechTranscriptionLegacyRecognizer.transcribe(file)
        case .none:
            throw SpeechTranscriptionFailure("UNSUPPORTED_DEVICE", "No on-device Apple speech API is available.")
        }
        return [
            "text": text,
            "language": SpeechTranscriptionLanguage.localeIdentifier,
            "segments": segments.map(\.dictionary),
            "engine": selectedEngine.rawValue,
            "runtimeVersion": ProcessInfo.processInfo.operatingSystemVersionString,
            "recordingDurationMs": Int(ceil(file.durationSeconds * 1000)),
        ]
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

extension RecordingFileSecurity {
    /// Only recorder-managed M4A/CAF files enter speech recognition; protection exceptions are test-fixture gated.
    static func protectedAudioFile(
        id: String,
        allowUnverifiedProtectionForSimulator: Bool = false,
    ) throws -> SpeechTranscriptionAudioFile {
        do {
            let url = try existingFileURL(
                id: id,
                allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator,
            )
            let audio = try AVAudioFile(forReading: url)
            let sampleRate = audio.processingFormat.sampleRate
            let duration = Double(audio.length) / sampleRate
            guard audio.length > 0, sampleRate.isFinite, sampleRate > 0, duration.isFinite, duration > 0 else {
                throw RecordingFileSecurityError.invalidAudioFile
            }
            return SpeechTranscriptionAudioFile(url: url, durationSeconds: duration)
        } catch RecordingFileSecurityError.recordingNotFound {
            throw SpeechTranscriptionFailure("RECORDING_FILE_MISSING", "The saved recording file was not found.")
        } catch RecordingFileSecurityError.protectionNotApplied,
            RecordingFileSecurityError.backupEligibilityNotApplied
        {
            throw SpeechTranscriptionFailure("AUDIO_STORAGE_UNPROTECTED", "The saved recording protection could not be verified.")
        } catch let failure as SpeechTranscriptionFailure {
            throw failure
        } catch {
            throw SpeechTranscriptionFailure("INVALID_AUDIO", "The saved recording could not be opened as audio.")
        }
    }
}
