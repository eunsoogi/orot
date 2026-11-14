import AVFoundation
import Foundation
import Speech

/// Captures one explicitly authorized turn in memory; audio never becomes a recording file.
/// The owner must hold the shared audio lease and configure the session before starting.
final class VoiceConversationCapture {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var completion: ((Result<String, Error>) -> Void)?
    private var tapInstalled = false
    private var generation: UUID?
    private var endOfTurn: DispatchWorkItem?
    private var partialTranscript = ""

    enum Failure: Error {
        case unavailable
        case alreadyStarted
        case cancelled
        case emptyTranscript
    }

    /// On-device support is checked before acquiring the microphone; server speech fallback is forbidden.
    func start(locale: Locale, completion: @escaping (Result<String, Error>) -> Void) throws -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        guard self.completion == nil else { throw Failure.alreadyStarted }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized,
              let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else { throw Failure.unavailable }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure.unavailable }
        let recognition = SFSpeechAudioBufferRecognitionRequest()
        recognition.requiresOnDeviceRecognition = true
        recognition.shouldReportPartialResults = true
        request = recognition
        self.completion = completion
        let current = UUID()
        generation = current
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            recognition.append(buffer)
        }
        tapInstalled = true
        task = recognizer.recognitionTask(with: recognition) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.generation == current, self.completion != nil else { return }
                if let result, result.isFinal {
                    let text = result.bestTranscription.formattedString
                    self.finish(text.isEmpty ? .failure(Failure.emptyTranscript) : .success(text))
                } else if let error {
                    self.finish(.failure(error))
                } else if let result {
                    let text = result.bestTranscription.formattedString
                    if !text.isEmpty, text != self.partialTranscript {
                        self.partialTranscript = text
                        self.endOfTurn?.cancel()
                        // A stable on-device partial ends this turn after a short pause. This is
                        // transcript endpointing, not simultaneous listening during TTS playback.
                        let end = DispatchWorkItem { [weak self] in
                            guard let self, generation == current else { return }
                            completeTurn()
                        }
                        self.endOfTurn = end
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: end)
                    }
                }
            }
        }
        do {
            engine.prepare()
            try engine.start()
            return true
        } catch {
            finish(.failure(error))
            return false
        }
    }

    /// End the input stream explicitly so recognition can emit a final transcript.
    func completeTurn() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard completion != nil else { return }
        endOfTurn?.cancel()
        endOfTurn = nil
        engine.stop()
        removeTap()
        request?.endAudio()
    }

    func cancel() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard completion != nil else { return }
        finish(.failure(Failure.cancelled))
    }

    private func finish(_ result: Result<String, Error>) {
        let callback = completion
        completion = nil
        generation = nil
        partialTranscript = ""
        endOfTurn?.cancel()
        endOfTurn = nil
        engine.stop()
        removeTap()
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        callback?(result)
    }

    private func removeTap() {
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
    }
}
