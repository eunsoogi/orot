import AVFoundation
import Darwin
import Foundation

/// The local, routed tone shares the call's player, but not its network or caption queues.
enum RealtimeVoiceConnectingCue {
    /// Contrasting pitches make readiness recognizable without a long sound or
    /// a device gain change. The player and iOS still own the actual route/volume.
    private static let segments: [(milliseconds: Int, frequency: Double, level: Double)] = [
        (44, 784, 0.22),
        (7, 0, 0),
        (62, 1176, 0.24),
    ]

    static func buffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let rate = format.sampleRate
        guard (8000.0 ... 96000.0).contains(rate), format.channelCount == 1 else { return nil }
        let lengths = segments.map { Int((rate * Double($0.milliseconds) / 1000).rounded()) }
        let count = AVAudioFrameCount(lengths.reduce(0, +))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count),
              let samples = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = count
        var offset = 0
        for (segment, length) in zip(segments, lengths) {
            for index in 0 ..< length {
                let progress = Double(index) / Double(length - 1)
                let envelope = sin(.pi * progress)
                let phase = 2 * .pi * segment.frequency * Double(index) / rate
                samples[offset + index] = Float(segment.level * sin(phase) * envelope * envelope)
            }
            offset += length
        }
        return buffer
    }
}

/// Check the capture timestamp, not delivery time: a pre-cue buffer can reach the tap late.
final class RealtimeVoiceCueCaptureFence: @unchecked Sendable {
    private let lock = NSLock()
    private var playedThrough: UInt64?

    func open(after hostTime: UInt64) {
        lock.lock(); defer { lock.unlock() }
        playedThrough = hostTime
    }

    func permits(hostTime: UInt64?) -> Bool {
        guard let hostTime, lock.try() else { return false }
        defer { lock.unlock() }
        return playedThrough.map { hostTime > $0 } ?? false
    }
}

/// Production graph accepts the owned readiness transition; test and legacy ports retain immediate start.
protocol RealtimeVoiceReadyCueAudioPort: RealtimeAudioPort {
    func start(input: @escaping (Data) -> Void, failure: @escaping () -> Void,
               playReadyCue: Bool, ready: @escaping () -> Void) throws
}

extension RealtimeVoiceCall {
    func finishAudioStart(input: @escaping (Data) -> Void, failure: @escaping () -> Void,
                          firstStart: Bool, ready: @escaping () -> Void) throws
    {
        if firstStart, let audio = audio as? RealtimeVoiceReadyCueAudioPort {
            try audio.start(input: input, failure: failure, playReadyCue: foreground(), ready: ready)
        } else {
            try audio.start(input: input, failure: failure)
            ready()
        }
    }
}
