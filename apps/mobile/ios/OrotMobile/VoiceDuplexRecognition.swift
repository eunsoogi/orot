import AVFoundation
import Foundation
import Speech

/// Continuous on-device recognition. The input sink swaps requests before finalizing an old turn,
/// so endpointing does not stop the audio engine or discard the start of a spoken interruption.
final class VoiceDuplexRecognition {
    enum Failure: Error { case unavailable, finalizationTimeout }
    private final class Turn {
        let request = SFSpeechAudioBufferRecognitionRequest()
        var task: SFSpeechRecognitionTask?
        var endpoint: DispatchWorkItem?
        var deadline: DispatchWorkItem?
        var text = ""
        var started = false
    }

    private let lock = NSLock()
    private var inputRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognizer: SFSpeechRecognizer?
    private var turns: [Int: Turn] = [:]
    private var sequence = 0
    private var active: Int?
    private var epoch = UUID()
    private var speechStarted: ((Int) -> Void)?
    private var transcript: ((Int, String) -> Void)?
    private var failure: ((Error) -> Void)?

    func start(locale: Locale, onSpeechStarted: @escaping (Int) -> Void,
               onTranscript: @escaping (Int, String) -> Void, onFailure: @escaping (Error) -> Void) throws
    {
        dispatchPrecondition(condition: .onQueue(.main))
        stop()
        guard SFSpeechRecognizer.authorizationStatus() == .authorized,
              let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else { throw Failure.unavailable }
        self.recognizer = recognizer
        speechStarted = onSpeechStarted
        transcript = onTranscript
        failure = onFailure
        beginTurn()
    }

    /// Called synchronously from the engine tap. The lock only serializes append versus request handoff.
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        inputRequest?.append(buffer)
        lock.unlock()
    }

    func finishTurn() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let active, let turn = turns[active], turn.started else { return }
        turn.endpoint?.cancel()
        turn.endpoint = nil
        // A fresh request receives the next input buffers before this request starts finalizing.
        beginTurn()
        turn.request.endAudio()
        let current = epoch
        let deadline = DispatchWorkItem { [weak self] in
            guard let self, self.epoch == current, self.turns[active] != nil else { return }
            self.fail(Failure.finalizationTimeout)
        }
        turn.deadline = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: deadline)
    }

    func stop() {
        dispatchPrecondition(condition: .onQueue(.main))
        epoch = UUID()
        lock.lock()
        inputRequest = nil
        lock.unlock()
        let pending = Array(turns.values)
        turns.removeAll()
        active = nil
        recognizer = nil
        speechStarted = nil
        transcript = nil
        failure = nil
        for turn in pending {
            turn.endpoint?.cancel()
            turn.deadline?.cancel()
            turn.request.endAudio()
            turn.task?.cancel()
        }
    }

    private func beginTurn() {
        guard let recognizer else { return }
        sequence += 1
        let id = sequence
        let current = epoch
        let turn = Turn()
        turn.request.requiresOnDeviceRecognition = true
        turn.request.shouldReportPartialResults = true
        turns[id] = turn
        active = id
        lock.lock()
        inputRequest = turn.request
        lock.unlock()
        turn.task = recognizer.recognitionTask(with: turn.request) { [weak self, weak turn] result, error in
            DispatchQueue.main.async {
                guard let self, let turn, self.epoch == current, self.turns[id] === turn else { return }
                if let error, result?.isFinal != true {
                    self.fail(error)
                } else if let result {
                    self.accept(result, id: id, turn: turn)
                }
            }
        }
    }

    private func accept(_ result: SFSpeechRecognitionResult, id: Int, turn: Turn) {
        let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty, !turn.started {
            turn.started = true
            speechStarted?(id)
        }
        if result.isFinal {
            turn.endpoint?.cancel()
            turn.deadline?.cancel()
            turns.removeValue(forKey: id)
            if active == id { beginTurn() }
            if !text.isEmpty { transcript?(id, text) }
        } else if !text.isEmpty, text != turn.text, active == id {
            turn.text = text
            turn.endpoint?.cancel()
            let current = epoch
            let endpoint = DispatchWorkItem { [weak self] in
                guard let self, self.epoch == current, self.active == id else { return }
                self.finishTurn()
            }
            turn.endpoint = endpoint
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: endpoint)
        }
    }

    private func fail(_ error: Error) {
        let callback = failure
        stop()
        callback?(error)
    }
}
