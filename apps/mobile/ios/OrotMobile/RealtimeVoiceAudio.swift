import AVFoundation
import Foundation

/// A dedicated echo-processed graph. Only explicitly consented Realtime calls use this sink.
protocol RealtimeAudioPort: AnyObject {
    var isDrained: Bool { get }
    var drained: (() -> Void)? { get set }
    func start(input: @escaping (Data) -> Void, failure: @escaping () -> Void) throws
    func append(_ data: Data) throws
    func cancel() -> Int
    func stop()
}

final class RealtimeVoiceAudio: RealtimeAudioPort {
    enum Failure: Error { case format, overflow }
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!
    private let output = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
    private var converter: AVAudioConverter?
    private var installed = false
    private var attached = false
    private var queued = 0
    private var epoch = 0
    private var startSample: AVAudioFramePosition?
    private var frames = 0
    var isDrained: Bool {
        queued == 0
    }

    var drained: (() -> Void)?

    func start(input: @escaping (Data) -> Void, failure: @escaping () -> Void) throws {
        let node = engine.inputNode
        try node.setVoiceProcessingEnabled(true)
        let format = node.outputFormat(forBus: 0)
        guard node.isVoiceProcessingEnabled, format.sampleRate > 0,
              let conversion = AVAudioConverter(from: format, to: pcm) else { throw Failure.format }
        converter = conversion
        engine.attach(player)
        attached = true
        engine.connect(player, to: engine.mainMixerNode, format: output)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [pcm] buffer, _ in
            // Conversion and delivery are synchronous: no borrowed tap buffer survives this callback.
            let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 24000 / format.sampleRate) + 32)
            guard let converted = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: capacity) else { failure(); return }
            var supplied = false
            var error: NSError?
            let status = conversion.convert(to: converted, error: &error) { _, state in
                if supplied {
                    state.pointee = .noDataNow; return nil
                }
                supplied = true; state.pointee = .haveData; return buffer
            }
            guard status != .error, error == nil, let samples = converted.int16ChannelData else { failure(); return }
            if converted.frameLength > 0 {
                input(Data(bytes: samples[0], count: Int(converted.frameLength) * 2))
            }
        }
        installed = true
        engine.prepare()
        try engine.start()
    }

    func append(_ data: Data) throws {
        guard !data.isEmpty, data.count % 2 == 0, data.count <= 480_000 else { throw Failure.format }
        let count = data.count / 2
        guard queued + count <= 24000 * 30,
              let buffer = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: AVAudioFrameCount(count)),
              let samples = buffer.floatChannelData?[0] else { throw Failure.overflow }
        data.withUnsafeBytes { raw in
            for index in 0 ..< count {
                let value = raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)
                samples[index] = Float(Int16(littleEndian: value)) / 32768
            }
        }
        buffer.frameLength = AVAudioFrameCount(count)
        queued += count
        frames += count
        let current = epoch
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.epoch == current else { return }
                self.queued -= count
                if self.queued == 0 {
                    self.drained?()
                }
            }
        }
        if !player.isPlaying {
            player.play()
        }
        if startSample == nil, let time = player.lastRenderTime, let position = player.playerTime(forNodeTime: time) {
            startSample = position.sampleTime
        }
    }

    /// Playback position, not received bytes, defines server conversation truncation.
    func cancel() -> Int {
        var played = 0
        if let time = player.lastRenderTime, let position = player.playerTime(forNodeTime: time) {
            played = min(frames, max(0, Int(position.sampleTime - (startSample ?? 0))))
        }
        epoch += 1
        player.stop()
        queued = 0; frames = 0; startSample = nil
        return played * 1000 / 24000
    }

    func stop() {
        _ = cancel()
        engine.stop()
        if installed {
            engine.inputNode.removeTap(onBus: 0); installed = false
        }
        if attached {
            engine.disconnectNodeOutput(player); engine.detach(player); attached = false
        }
        converter = nil
    }
}

/// Bounds copied microphone bytes waiting for the main queue; no unbounded tap callback backlog.
final class RealtimeInputBudget {
    private let lock = NSLock()
    enum Result { case accepted, closed, overflow }
    private var bytes = 0
    private var closed = false
    func reset() {
        lock.lock(); closed = false; lock.unlock()
    }

    func reserve(_ count: Int) -> Result {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { return .closed }
        guard bytes + count <= 96000 else { closed = true; return .overflow }
        bytes += count; return .accepted
    }

    func release(_ count: Int) {
        lock.lock(); bytes -= count; lock.unlock()
    }
}
