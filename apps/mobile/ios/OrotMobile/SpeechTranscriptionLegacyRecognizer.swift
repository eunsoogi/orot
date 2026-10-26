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

        let gate = SpeechTranscriptionContinuation<(String, [SpeechTranscriptionSegment])>()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                gate.install(continuation)
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
                gate.attachCancellation { task.cancel() }
            }
        } onCancel: {
            gate.cancel()
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

/// Bridges the legacy callback and task cancellation without double-resuming its continuation.
final class SpeechTranscriptionContinuation<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var completion: Result<Value, Error>?
    private var cancellationRequested = false
    private var cancelAction: (() -> Void)?

    func install(_ continuation: CheckedContinuation<Value, Error>) {
        lock.lock()
        if let completion {
            lock.unlock()
            continuation.resume(with: completion)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    func attachCancellation(_ action: @escaping () -> Void) {
        lock.lock()
        if cancellationRequested {
            lock.unlock()
            action()
            return
        }
        guard case .none = completion else {
            lock.unlock()
            return
        }
        cancelAction = action
        lock.unlock()
    }

    func complete(_ result: Result<Value, Error>) {
        lock.lock()
        guard case .none = completion else {
            lock.unlock()
            return
        }
        completion = result
        let continuation = continuation
        self.continuation = nil
        cancelAction = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    func cancel() {
        lock.lock()
        guard case .none = completion else {
            lock.unlock()
            return
        }
        cancellationRequested = true
        let result = Result<Value, Error>.failure(SpeechTranscriptionDeadline.cancelledFailure())
        completion = result
        let continuation = continuation
        let cancelAction = cancelAction
        self.continuation = nil
        self.cancelAction = nil
        lock.unlock()

        cancelAction?()
        continuation?.resume(with: result)
    }
}
