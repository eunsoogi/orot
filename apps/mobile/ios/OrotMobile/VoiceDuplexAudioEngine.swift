import AVFoundation
import Foundation

/// One call owns one voice-processing graph. PCM never leaves memory or this graph.
/// The bridge owns permissions and the AudioSessionOwnership token for the whole call.
final class VoiceDuplexAudioEngine {
    enum Failure: Error { case unsupportedInput, unavailableConversion, synthesis }
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let synthesizer = AVSpeechSynthesizer()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
    private var converter: AVAudioConverter?
    private var tapInstalled = false
    private var playerAttached = false
    private var generation = UUID()
    private var pendingBuffers = 0
    private var synthesisEnded = false
    private var completion: ((Bool) -> Void)?

    /// Input is already echo-processed; the sink must consume it synchronously without retaining raw audio.
    func start(input: @escaping (AVAudioPCMBuffer) -> Void) throws {
        dispatchPrecondition(condition: .onQueue(.main))
        guard !engine.isRunning else { return }
        let node = engine.inputNode
        try node.setVoiceProcessingEnabled(true)
        guard node.isVoiceProcessingEnabled else { throw Failure.unsupportedInput }
        let inputFormat = node.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else { throw Failure.unsupportedInput }
        engine.attach(player)
        playerAttached = true
        engine.connect(player, to: engine.mainMixerNode, format: format)
        node.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { buffer, _ in input(buffer) }
        tapInstalled = true
        do {
            engine.prepare()
            try engine.start()
        } catch {
            stop()
            throw error
        }
    }

    /// Synthesizer output is scheduled into the same graph that supplies the AEC render reference.
    func speak(_ text: String, language: String, completion: @escaping (Bool) -> Void) throws {
        dispatchPrecondition(condition: .onQueue(.main))
        guard engine.isRunning, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw Failure.synthesis }
        cancelPlayback()
        self.completion = completion
        let current = generation
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language)
        synthesizer.write(utterance) { [weak self] buffer in
            DispatchQueue.main.async {
                guard let self, self.generation == current, self.completion != nil else { return }
                guard let pcm = buffer as? AVAudioPCMBuffer else { self.cancelPlayback(); return }
                if pcm.frameLength == 0 {
                    do { try self.drainConverter(generation: current) }
                    catch { self.cancelPlayback(); return }
                    self.synthesisEnded = true
                    self.completeIfDrained()
                    return
                }
                do { try self.enqueue(pcm, generation: current) }
                catch { self.cancelPlayback() }
            }
        }
    }

    /// Invalidates synthesis and queued completions before stopping the player; microphone stays live.
    func cancelPlayback() {
        dispatchPrecondition(condition: .onQueue(.main))
        generation = UUID()
        player.stop()
        synthesizer.stopSpeaking(at: .immediate)
        pendingBuffers = 0
        synthesisEnded = false
        converter = nil
        let callback = completion
        completion = nil
        callback?(false)
    }

    func stop() {
        dispatchPrecondition(condition: .onQueue(.main))
        cancelPlayback()
        engine.stop()
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if playerAttached {
            engine.disconnectNodeOutput(player)
            engine.detach(player)
            playerAttached = false
        }
    }

    private func enqueue(_ buffer: AVAudioPCMBuffer, generation current: UUID) throws {
        if converter == nil || converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: format)
        }
        guard let converter else { throw Failure.unavailableConversion }
        let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 32)
        guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { throw Failure.unavailableConversion }
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: converted, error: &error) { _, outStatus in
            if supplied { outStatus.pointee = .noDataNow; return nil }
            supplied = true
            outStatus.pointee = .haveData
            return buffer
        }
        if let error { throw error }
        guard status != .error else { throw Failure.unavailableConversion }
        schedule(converted, generation: current)
    }

    private func drainConverter(generation current: UUID) throws {
        guard let converter, let tail = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { return }
        var error: NSError?
        let status = converter.convert(to: tail, error: &error) { _, outStatus in
            outStatus.pointee = .endOfStream
            return nil
        }
        if let error { throw error }
        guard status != .error else { throw Failure.unavailableConversion }
        schedule(tail, generation: current)
    }

    private func schedule(_ converted: AVAudioPCMBuffer, generation current: UUID) {
        guard converted.frameLength > 0 else { return }
        pendingBuffers += 1
        player.scheduleBuffer(converted, at: nil, options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
            // Player callbacks must never stop the node on its render thread.
            DispatchQueue.main.async {
                guard let self, self.generation == current else { return }
                self.pendingBuffers -= 1
                self.completeIfDrained()
            }
        }
        if !player.isPlaying { player.play() }
    }

    private func completeIfDrained() {
        guard synthesisEnded, pendingBuffers == 0 else { return }
        let callback = completion
        completion = nil
        converter = nil
        callback?(true)
    }
}
