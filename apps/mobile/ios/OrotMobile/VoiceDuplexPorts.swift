import AVFoundation
import Foundation

/// Injectable graph boundaries let lifecycle tests run without microphone, recognition or speech output.
protocol VoiceDuplexAudioPort: AnyObject {
    func start(input: @escaping (AVAudioPCMBuffer) -> Void) throws
    func speak(_ text: String, language: String, completion: @escaping (Bool) -> Void) throws
    func cancelPlayback()
    func stop()
}

protocol VoiceDuplexRecognitionPort: AnyObject {
    func start(locale: Locale, onSpeechStarted: @escaping (Int) -> Void,
               onTranscript: @escaping (Int, String) -> Void, onFailure: @escaping (Error) -> Void) throws
    func append(_ buffer: AVAudioPCMBuffer)
    func finishTurn()
    func stop()
}

extension VoiceDuplexAudioEngine: VoiceDuplexAudioPort {}
extension VoiceDuplexRecognition: VoiceDuplexRecognitionPort {}
