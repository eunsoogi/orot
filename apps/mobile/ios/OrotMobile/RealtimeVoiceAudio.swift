import AVFoundation
import Darwin
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

enum RealtimeVoiceLevelDirection: Int {
    case input, output
}

/// Only an owned call should supply this optional presentation sink.
protocol RealtimeVoiceDisplayMeterPort: AnyObject {
    var displayLevel: ((RealtimeVoiceLevelDirection, Double) -> Void)? { get set }
}

final class RealtimeVoiceAudio: RealtimeAudioPort, RealtimeVoiceDisplayMeterPort {
    enum Failure: Error { case format, overflow }
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!
    private let output = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
    private var converter: AVAudioConverter?
    private var installed = false
    private var attached = false
    private var outputMeterInstalled = false
    private let levelMeter = RealtimeVoiceDisplayMeter()
    var displayLevel: ((RealtimeVoiceLevelDirection, Double) -> Void)?
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
        let meterEpoch = levelMeter.begin(displayLevel)
        if let meterEpoch {
            // This is the existing player's rendered output, not enqueued audio or network deltas.
            player.installTap(onBus: 0, bufferSize: 1024, format: nil) { [levelMeter] buffer, time in
                guard time.isHostTimeValid, let values = buffer.floatChannelData?[0] else { return }
                levelMeter.sample(.output, epoch: meterEpoch, hostTime: time.hostTime, count: Int(buffer.frameLength)) { Double(values[$0]) }
            }
            outputMeterInstalled = true
        }
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [pcm, levelMeter] buffer, _ in
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
                if let meterEpoch {
                    levelMeter.sample(.input, epoch: meterEpoch, hostTime: nil, count: Int(converted.frameLength)) { Double(samples[0][$0]) / 32768 }
                }
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
        if queued == 0 {
            levelMeter.beginOutput(at: mach_absolute_time())
        }
        queued += count
        frames += count
        let current = epoch
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.epoch == current else { return }
                self.queued -= count
                if self.queued == 0 {
                    self.levelMeter.resetOutput()
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

    /// Read render time only for an attached player; AVFAudio asserts before attachment.
    func cancel() -> Int {
        levelMeter.resetOutput()
        var played = 0
        let canStopPlayer = attached && player.engine === engine
        if canStopPlayer, let time = player.lastRenderTime, let position = player.playerTime(forNodeTime: time) {
            played = min(frames, max(0, Int(position.sampleTime - (startSample ?? 0))))
        }
        epoch += 1
        if canStopPlayer {
            player.stop()
        }
        queued = 0; frames = 0; startSample = nil
        return played * 1000 / 24000
    }

    func stop() {
        _ = levelMeter.begin(nil)
        _ = cancel()
        engine.stop()
        if outputMeterInstalled {
            player.removeTap(onBus: 0)
            outputMeterInstalled = false
        }
        if installed {
            engine.inputNode.removeTap(onBus: 0); installed = false
        }
        if attached {
            engine.disconnectNodeOutput(player); engine.detach(player); attached = false
        }
        converter = nil
    }
}

/// Audio taps reduce at most 64 borrowed samples; no PCM survives the callback.
/// All shared state is locked, and only a scalar reaches the main-queue observer.
final class RealtimeVoiceDisplayMeter: @unchecked Sendable {
    typealias Sink = (RealtimeVoiceLevelDirection, Double) -> Void
    private let lock = NSLock()
    private var sink: Sink?
    private var callEpoch = UUID(), epochs = [UUID(), UUID()]
    private var outputFloor: UInt64?, pending = [false, false]
    private var last = [-Double.infinity, -Double.infinity]

    func begin(_ observer: Sink?) -> UUID? {
        lock.lock(); defer { lock.unlock() }
        sink = observer
        callEpoch = UUID(); epochs = [UUID(), UUID()]
        outputFloor = nil; last = [-Double.infinity, -Double.infinity]; pending = [false, false]
        return observer == nil ? nil : callEpoch
    }

    func beginOutput(at start: UInt64) {
        lock.lock(); outputFloor = start; lock.unlock()
    }

    func resetOutput() {
        lock.lock(); outputFloor = nil
        epochs[RealtimeVoiceLevelDirection.output.rawValue] = UUID()
        last[RealtimeVoiceLevelDirection.output.rawValue] = -Double.infinity
        pending[RealtimeVoiceLevelDirection.output.rawValue] = false
        let observer = sink
        lock.unlock()
        observer?(.output, 0)
    }

    func sample(_ direction: RealtimeVoiceLevelDirection, epoch: UUID, hostTime: UInt64?, count: Int, value: (Int) -> Double) {
        let index = direction.rawValue, now = ProcessInfo.processInfo.systemUptime
        guard lock.try() else { return }
        let rendered = direction == .input || hostTime.flatMap { time in outputFloor.map { time >= $0 } } == true
        guard sink != nil, epoch == callEpoch, rendered, !pending[index], now - last[index] >= 0.1 else { lock.unlock(); return }
        last[index] = now; pending[index] = true
        let current = epochs[index]
        lock.unlock()
        let level = Self.level(count: count, value: value)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            lock.lock()
            let owned = epochs[index] == current
            if owned {
                pending[index] = false
            }
            let observer = owned ? sink : nil
            lock.unlock()
            observer?(direction, level)
        }
    }

    static func level(count: Int, value: (Int) -> Double) -> Double {
        guard count > 0 else { return 0 }
        let reads = min(count, 64)
        var energy = 0.0
        for index in 0 ..< reads {
            let number = value(index * count / reads)
            guard number.isFinite else { return 0 }
            let amplitude = min(abs(number), 1)
            energy += amplitude * amplitude
        }
        return min(1, sqrt(energy / Double(reads)))
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
