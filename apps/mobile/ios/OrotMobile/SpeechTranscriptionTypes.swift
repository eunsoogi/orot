import Foundation

/// Protected temporary audio retains its original duration through format conversion.
struct SpeechTranscriptionAudioFile {
    let url: URL
    let durationSeconds: Double
}

enum SpeechTranscriptionStatus: String {
    case available
    case unsupportedLanguage = "unsupported_language"
    case unsupportedDevice = "unsupported_device"
    case modelUnavailable = "model_unavailable"
    case permissionNotDetermined = "permission_not_determined"
    case permissionDenied = "permission_denied"
    case permissionRestricted = "permission_restricted"
    case recognizerUnavailable = "recognizer_unavailable"
}

enum SpeechTranscriptionEngineKind: String {
    case speechTranscriber = "speech_transcriber"
    case dictationTranscriber = "dictation_transcriber"
    case onDeviceSpeechRecognizer = "on_device_speech_recognizer"
    case none
}

struct SpeechTranscriptionAvailabilityResult {
    let status: SpeechTranscriptionStatus
    let engine: SpeechTranscriptionEngineKind
    let locale: String
    let modelInstalled: Bool?

    var dictionary: [String: Any] {
        var value: [String: Any] = [
            "status": status.rawValue,
            "engine": engine.rawValue,
            "locale": locale,
        ]
        if let modelInstalled {
            value["modelInstalled"] = modelInstalled
        }
        return value
    }

    static func failure(
        _ status: SpeechTranscriptionStatus,
        locale: String,
        engine: SpeechTranscriptionEngineKind = .none,
    ) -> SpeechTranscriptionAvailabilityResult {
        SpeechTranscriptionAvailabilityResult(status: status, engine: engine, locale: locale, modelInstalled: nil)
    }
}

struct SpeechTranscriptionSegment {
    // Keep ranges relative to the audio file so callers can link transcript text back to recorded evidence.
    let startSeconds: Double
    let endSeconds: Double
    let text: String

    var dictionary: [String: Any] {
        ["startSeconds": startSeconds, "endSeconds": endSeconds, "text": text]
    }
}

struct SpeechTranscriptionFailure: Error {
    let code: String
    let message: String

    init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }
}

enum SpeechTranscriptionLanguage {
    static let localeIdentifier = "ko-KR"

    static func isSupportedRequest(_ value: String) -> Bool {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-")
            .split(separator: "-")
            .first?
            .lowercased() == "ko"
    }
}
