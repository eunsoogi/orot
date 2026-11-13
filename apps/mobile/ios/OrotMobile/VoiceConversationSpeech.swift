import AVFoundation
import Foundation

/// Plays one answer using a retained synthesizer; the caller owns audio-session arbitration.
final class VoiceConversationSpeech: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var utterance: AVSpeechUtterance?
    private var completion: ((Bool) -> Void)?
    private var stopRequested = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, language: String, completion: @escaping (Bool) -> Void) -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        guard utterance == nil, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let value = AVSpeechUtterance(string: text)
        value.voice = AVSpeechSynthesisVoice(language: language)
        utterance = value
        stopRequested = false
        self.completion = completion
        synthesizer.speak(value)
        return true
    }

    @discardableResult func stop() -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        guard utterance != nil else { return true }
        stopRequested = true
        guard synthesizer.stopSpeaking(at: .immediate) else { return false }
        finish(false)
        return true
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
        callback?(spoken)
    }
}
