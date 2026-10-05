import Foundation
import Speech

enum SpeechTranscriptionLegacyRecognizer {
    static func transcribe(_ file: SpeechTranscriptionAudioFile) async throws -> (String, [SpeechTranscriptionSegment]) {
        let locale = Locale(identifier: SpeechTranscriptionLanguage.localeIdentifier)
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            throw SpeechTranscriptionFailure("UNSUPPORTED_LANGUAGE", "Apple Speech does not support Korean for this request.")
        }
        guard recognizer.supportsOnDeviceRecognition else {
            throw SpeechTranscriptionFailure("UNSUPPORTED_DEVICE", "This recognizer cannot keep audio on device.")
        }
        guard recognizer.isAvailable else {
            throw SpeechTranscriptionFailure("RECOGNIZER_UNAVAILABLE", "Apple on-device speech is temporarily unavailable.")
        }

        let request = SFSpeechURLRecognitionRequest(url: file.url)
        // supportsOnDeviceRecognition was checked above; this flag forbids network recognition for this request.
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.taskHint = .dictation

        return try await withCheckedThrowingContinuation { continuation in
            let gate = SpeechTranscriptionContinuation<(String, [SpeechTranscriptionSegment])>(continuation)
            let task = recognizer.recognitionTask(with: request) { result, error in
                if let error {
                    gate.complete(.failure(SpeechTranscriptionFailure("SPEECH_RECOGNITION_FAILED", error.localizedDescription)))
                    return
                }
                guard let result, result.isFinal else { return }

                let segments = result.bestTranscription.segments.map { segment in
                    SpeechTranscriptionSegment(
                        startSeconds: segment.timestamp,
                        endSeconds: segment.timestamp + segment.duration,
                        text: segment.substring,
                    )
                }
                do {
                    try validate(segments, duration: file.durationSeconds)
                    gate.complete(.success((result.bestTranscription.formattedString, segments)))
                } catch {
                    gate.complete(.failure(error))
                }
            }
            gate.attach(task)
        }
    }

    private static func validate(_ segments: [SpeechTranscriptionSegment], duration: Double) throws {
        var previousStart = -1.0
        for segment in segments {
            guard segment.startSeconds.isFinite, segment.endSeconds.isFinite,
                  segment.startSeconds >= 0, segment.endSeconds > segment.startSeconds,
                  segment.endSeconds <= duration + 0.1, segment.startSeconds >= previousStart
            else {
                throw SpeechTranscriptionFailure("INVALID_TIMESTAMP", "Apple Speech returned an invalid segment time range.")
            }
            previousStart = segment.startSeconds
        }
    }
}

private final class SpeechTranscriptionContinuation<Value> {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var task: SFSpeechRecognitionTask?

    init(_ continuation: CheckedContinuation<Value, Error>) {
        self.continuation = continuation
    }

    func attach(_ task: SFSpeechRecognitionTask) {
        lock.lock()
        guard continuation != nil else {
            lock.unlock()
            task.cancel()
            return
        }
        self.task = task
        lock.unlock()
    }

    func complete(_ result: Result<Value, Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        task = nil
        lock.unlock()
        pending?.resume(with: result)
    }
}
