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

/// Returns a terminal result even when a system async call ignores task cancellation.
enum SpeechTranscriptionDeadline {
    static let productionTimeoutNanoseconds: UInt64 = 120_000_000_000

    static func run<Value>(
        timeoutNanoseconds: UInt64 = productionTimeoutNanoseconds,
        operation: @escaping () async throws -> Value,
    ) async throws -> Value {
        let race = Race<Value>()
        // The worker reads an immutable request snapshot; this box crosses the deadline race's unstructured task boundary.
        let work = Work(operation)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                race.begin(
                    continuation,
                    timeoutNanoseconds: timeoutNanoseconds,
                    work: work,
                )
            }
        } onCancel: {
            race.cancel()
        }
    }

    static func cancelledFailure() -> SpeechTranscriptionFailure {
        SpeechTranscriptionFailure("TRANSCRIPTION_CANCELLED", "The speech transcription request was cancelled.")
    }

    static func timeoutFailure() -> SpeechTranscriptionFailure {
        SpeechTranscriptionFailure("TRANSCRIPTION_TIMEOUT", "The speech transcription request exceeded its time limit.")
    }

    private final class Work<Value>: @unchecked Sendable {
        let operation: () async throws -> Value

        init(_ operation: @escaping () async throws -> Value) {
            self.operation = operation
        }
    }

    private final class Race<Value>: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation: CheckedContinuation<Value, Error>?
        private var result: Result<Value, Error>?
        private var worker: Task<Void, Never>?
        private var timer: Task<Void, Never>?

        func begin(
            _ continuation: CheckedContinuation<Value, Error>,
            timeoutNanoseconds: UInt64,
            work: Work<Value>,
        ) {
            lock.lock()
            if let result {
                lock.unlock()
                continuation.resume(with: result)
                return
            }
            self.continuation = continuation
            lock.unlock()

            // An unstructured worker lets the caller return at the deadline even if a system API ignores cancellation.
            let worker = Task.detached { [self, work] in
                do {
                    try await finish(.success(work.operation()), cancelWorker: false)
                } catch {
                    finish(.failure(error), cancelWorker: false)
                }
            }
            let timer = Task.detached { [self] in
                do {
                    try await Task.sleep(nanoseconds: timeoutNanoseconds)
                    finish(.failure(SpeechTranscriptionDeadline.timeoutFailure()), cancelWorker: true)
                } catch {
                    // Normal completion or explicit cancellation disarms the timer.
                }
            }
            attach(worker: worker, timer: timer)
        }

        func cancel() {
            finish(.failure(SpeechTranscriptionDeadline.cancelledFailure()), cancelWorker: true)
        }

        private func attach(worker: Task<Void, Never>, timer: Task<Void, Never>) {
            lock.lock()
            let alreadyFinished: Bool
            if case .some = result {
                alreadyFinished = true
            } else {
                self.worker = worker
                self.timer = timer
                alreadyFinished = false
            }
            lock.unlock()

            if alreadyFinished {
                worker.cancel()
                timer.cancel()
            }
        }

        private func finish(_ result: Result<Value, Error>, cancelWorker: Bool) {
            lock.lock()
            guard case .none = self.result else {
                lock.unlock()
                return
            }
            self.result = result
            let continuation = continuation
            let worker = worker
            let timer = timer
            self.continuation = nil
            self.worker = nil
            self.timer = nil
            lock.unlock()

            if cancelWorker {
                worker?.cancel()
            }
            timer?.cancel()
            continuation?.resume(with: result)
        }
    }
}

/// Cancels asynchronous Speech work without waiting for a stalled result stream to finish.
enum SpeechTranscriptionTaskCancellation {
    static func withAnalyzerCancellation<Result>(
        start: () async throws -> Void,
        collectResults: @escaping () async throws -> Result,
        cancel: @escaping () async -> Void,
    ) async throws -> Result {
        let results = Task { try await collectResults() }
        return try await withTaskCancellationHandler {
            do {
                try Task.checkCancellation()
                try await start()
                try Task.checkCancellation()
                return try await results.value
            } catch {
                results.cancel()
                if !Task.isCancelled {
                    await cancel()
                }
                throw error
            }
        } onCancel: {
            results.cancel()
            Task { await cancel() }
        }
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
