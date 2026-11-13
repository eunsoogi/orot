import AVFoundation
import Foundation

/// Mutable speech state is main-queue confined; delegate callbacks hop there before touching it.
/// The caller owns audio-session arbitration and keeps the synthesizer alive through completion.
final class VoiceConversationSpeech: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let synthesizer = AVSpeechSynthesizer()
    private var utterance: AVSpeechUtterance?
    private var completion: ((Bool) -> Void)?
    private var stopRequested = false
    private var submitted = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, language: String, volume: Float = 1, completion: @escaping (Bool) -> Void) -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        guard utterance == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let value = AVSpeechUtterance(string: text)
        value.voice = AVSpeechSynthesisVoice(language: language)
        // Explicit volume preserves normal playback while permitting silent system-lifecycle observations.
        value.volume = min(1, max(0, volume))
        utterance = value
        stopRequested = false
        self.completion = completion
        submitted = false
        // A same-turn Stop must cancel before AVFoundation asynchronously accepts the utterance.
        DispatchQueue.main.async { [weak self] in
            guard let self, utterance === value else { return }
            submitted = true
            synthesizer.speak(value)
        }
        return true
    }

    @discardableResult func stop() -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        guard utterance != nil else { return true }
        stopRequested = true
        // False retains the caller's audio lease until the delegate confirms cancellation.
        // AVFoundation may briefly reject Stop after submission but before didStart.
        guard !submitted || synthesizer.stopSpeaking(at: .immediate) else { return false }
        finish(false)
        return true
    }

    func speechSynthesizer(_: AVSpeechSynthesizer, didStart value: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self, utterance === value, stopRequested else { return }
            if synthesizer.stopSpeaking(at: .immediate) {
                finish(false)
            }
        }
    }

    func speechSynthesizer(_: AVSpeechSynthesizer, didFinish value: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self, utterance === value else { return }
            finish(!stopRequested)
        }
    }

    func speechSynthesizer(_: AVSpeechSynthesizer, didCancel value: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self, utterance === value else { return }
            finish(false)
        }
    }

    private func finish(_ spoken: Bool) {
        let callback = completion
        completion = nil
        utterance = nil
        submitted = false
        callback?(spoken)
    }
}
