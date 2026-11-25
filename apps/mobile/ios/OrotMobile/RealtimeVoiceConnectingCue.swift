import AVFoundation
import Darwin
import Foundation

/// The local, routed tone shares the call's player, but not its network or caption queues.
enum RealtimeVoiceConnectingCue {
    static func buffer(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let sampleCount: AVAudioFrameCount = 2040
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: sampleCount),
              let samples = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = sampleCount
        for index in 0 ..< Int(sampleCount) {
            let progress = Double(index) / Double(sampleCount - 1)
            let envelope = sin(.pi * progress)
            samples[index] = Float((4200.0 / 32768) * sin(2 * .pi * 520 * Double(index) / 24000) * envelope * envelope)
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
