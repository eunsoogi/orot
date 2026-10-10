import Foundation
import React

@objc(SpeechTranscriptionModule)
public final class SpeechTranscriptionModule: NSObject {
    private let transcriptionRequests = SpeechTranscriptionRequestRegistry()

    @objc public static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(getAvailability:resolver:rejecter:)
    public func getAvailability(
        _ language: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock,
    ) {
        // Keep diagnostics read-only; the legacy API prompts only after a transcription action is requested.
        Task {
            await resolve(SpeechTranscriptionEngine.availability(language: language).dictionary)
        }
    }

    @objc(transcribeAudio:resolver:rejecter:)
    public func transcribeAudio(
        _ request: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        performTranscription(
            request as? [String: Any] ?? [:],
            resolver: resolve,
            rejecter: reject,
            operation: SpeechTranscriptionEngine.transcribe,
        )
    }

    @objc(transcribeRecording:resolver:rejecter:)
    public func transcribeRecording(
        _ request: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        // Only the UUID crosses the bridge; the protected recording path stays native.
        performTranscription(
            request as? [String: Any] ?? [:],
            resolver: resolve,
            rejecter: reject,
            operation: SpeechTranscriptionEngine.transcribeRecording,
        )
    }

    @objc(cancelTranscription:)
    public func cancelTranscription(_ requestID: String) {
        transcriptionRequests.cancel(requestID)
    }

    private func performTranscription(
        _ request: [String: Any],
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
        operation: @escaping ([String: Any]) async throws -> [String: Any],
    ) {
        let requestID = (request["requestId"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
        guard let handle = transcriptionRequests.reserve(requestID) else {
            reject("TRANSCRIPTION_REQUEST_CONFLICT", "A speech transcription request with this identifier is already active.", nil)
            return
        }

        let registry = transcriptionRequests
        let task = Task {
            defer { registry.finish(requestID, handle: handle) }
            do {
                try await resolve(operation(request))
            } catch let failure as SpeechTranscriptionFailure {
                reject(failure.code, failure.message, nil)
            } catch is CancellationError {
                let failure = SpeechTranscriptionDeadline.cancelledFailure()
                reject(failure.code, failure.message, nil)
            } catch {
                reject("SPEECH_RECOGNITION_FAILED", error.localizedDescription, error as NSError)
            }
        }
        handle.attach(task)
    }
}

private final class SpeechTranscriptionRequestHandle: @unchecked Sendable {
    private let lock = NSLock()
    private var task: Task<Void, Never>?
    private var cancellationRequested = false

    func attach(_ task: Task<Void, Never>) {
        lock.lock()
        if cancellationRequested {
            lock.unlock()
            task.cancel()
            return
        }
        self.task = task
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancellationRequested = true
        let task = task
        lock.unlock()
        task?.cancel()
    }
}

private final class SpeechTranscriptionRequestRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var active: [String: SpeechTranscriptionRequestHandle] = [:]

    func reserve(_ requestID: String) -> SpeechTranscriptionRequestHandle? {
        lock.lock()
        defer { lock.unlock() }
        guard active[requestID] == nil else { return nil }
        let handle = SpeechTranscriptionRequestHandle()
        active[requestID] = handle
        return handle
    }

    func cancel(_ requestID: String) {
        lock.lock()
        let handle = active[requestID]
        lock.unlock()
        handle?.cancel()
    }

    func finish(_ requestID: String, handle: SpeechTranscriptionRequestHandle) {
        lock.lock()
        if active[requestID] === handle {
            active.removeValue(forKey: requestID)
        }
        lock.unlock()
    }
}
