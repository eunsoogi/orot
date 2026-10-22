import AVFoundation
import Foundation

/// Opt-in lifecycle observations never include audio, paths, identifiers or native error descriptions.
enum RecordingCaptureDiagnostics {
    enum Event: String, CaseIterable {
        case permissionFirst = "permission_first"
        case permissionKnown = "permission_known"
        case permissionGranted = "permission_granted"
        case permissionDenied = "permission_denied"
        case started, paused, resumed, stopping, stopped, finished
        case finishFailed = "finish_failed"
        case encodeFailed = "encode_failed"
        case interrupted, backgrounded
        case speechStarted = "speech_started"
        case speechCompleted = "speech_completed"
    }

    static var enabled: Bool {
        ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS")
    }

    static func emit(_ event: Event, clockMs: Int? = nil, fileURL: URL? = nil) {
        guard enabled else { return }
        // File inspection happens only at explicit completion boundaries and only when opted in.
        let encodedMs = fileURL.flatMap { try? encodedDurationMs(at: $0) }
        NSLog("%@", line(event, clockMs: clockMs, encodedMs: encodedMs))
    }

    static func failure(_ code: String) {
        guard enabled else { return }
        NSLog("%@", failureLine(code))
    }

    static func line(_ event: Event, clockMs: Int? = nil, encodedMs: Int? = nil) -> String {
        var value = "OROT_RECORDING_DIAGNOSTIC event=\(event.rawValue)"
        if let clockMs, clockMs >= 0 {
            value += " clock_ms=\(clockMs)"
        }
        if let encodedMs, encodedMs >= 0 {
            value += " encoded_ms=\(encodedMs)"
        }
        return value
    }

    static func failureLine(_ code: String) -> String {
        let allowed = Set([
            "UNSUPPORTED_LANGUAGE", "UNSUPPORTED_DEVICE", "MODEL_UNAVAILABLE", "MODEL_INSTALL_FAILED",
            "PERMISSION_DENIED", "PERMISSION_RESTRICTED", "PERMISSION_NOT_DETERMINED",
            "RECOGNIZER_UNAVAILABLE", "RECORDING_FILE_MISSING", "AUDIO_STORAGE_UNPROTECTED",
            "INVALID_AUDIO", "AUDIO_CONVERSION_FAILED", "INVALID_TIMESTAMP",
            "TRANSCRIPTION_CANCELLED", "TRANSCRIPTION_TIMEOUT", "SPEECH_RECOGNITION_FAILED",
        ])
        let reason = allowed.contains(code) ? code : "OTHER"
        return "OROT_RECORDING_DIAGNOSTIC event=speech_failed reason=\(reason)"
    }

    /// Use the decoded frame clock, not recorder metadata or wall time; subsecond files remain observable.
    static func encodedDurationMs(at url: URL) throws -> Int {
        let file = try AVAudioFile(forReading: url)
        let rate = file.processingFormat.sampleRate
        let milliseconds = Double(file.length) / rate * 1000
        guard rate.isFinite, rate > 0, milliseconds.isFinite,
              milliseconds >= 0, milliseconds < Double(Int.max)
        else { throw CocoaError(.fileReadCorruptFile) }
        return Int(milliseconds.rounded(.down))
    }
}
