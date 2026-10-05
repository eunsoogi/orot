import Foundation
import React

@objc(SpeechTranscriptionModule)
public final class SpeechTranscriptionModule: NSObject {
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
        Task {
            do {
                try await resolve(SpeechTranscriptionEngine.transcribe(request as? [String: Any] ?? [:]))
            } catch let failure as SpeechTranscriptionFailure {
                reject(failure.code, failure.message, nil)
            } catch {
                reject("SPEECH_RECOGNITION_FAILED", error.localizedDescription, error as NSError)
            }
        }
    }
}
