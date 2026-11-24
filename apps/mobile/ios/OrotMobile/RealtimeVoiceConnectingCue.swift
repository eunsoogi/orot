import AVFoundation
import Foundation

protocol RealtimeConnectingCuePort: AnyObject {
    func play(ownership: AudioSessionOwnership, token: AudioSessionOwnership.Token, finished: @escaping (Bool) -> Void)
    func cancel()
}

/// Short, local-only audio. Ambient does not bypass the silent switch or mix policy.
final class RealtimeConnectingCue: NSObject, AVAudioPlayerDelegate, RealtimeConnectingCuePort {
    private var player: AVAudioPlayer?
    private var fallback: DispatchWorkItem?
    private var completion: (() -> Void)?

    func play(ownership: AudioSessionOwnership, token: AudioSessionOwnership.Token, finished: @escaping (Bool) -> Void) {
        guard completion == nil else { finished(false); return }
        guard let next = try? AVAudioPlayer(data: Self.wave()) else { finished(true); return }
        player = next
        completion = {
            do { try ownership.suspend(token); finished(true) } catch { finished(false) }
        }
        do {
            try ownership.activate(token, category: .ambient, mode: .default)
            next.delegate = self
            guard next.play() else { finish(); return }
            let work = DispatchWorkItem { [weak self, weak next] in
                guard let self, let next, player === next else { return }
                finish()
            }
            fallback = work
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(200), execute: work)
        } catch {
            finish()
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
        DispatchQueue.main.async { [weak self, weak player] in
            guard let self, let player, self.player === player else { return }
            finish()
        }
    }

    func cancel() {
        completion = nil
        fallback?.cancel(); fallback = nil
        player?.stop(); player = nil
    }

    private func finish() {
        let callback = completion
        cancel()
        callback?()
    }

    /// A single soft sine with eased ends, PCM 16-bit / 16 kHz / 85 ms.
    static func wave() -> Data {
        let sampleCount = 1360
        var data = Data()
        func append<T: FixedWidthInteger>(_ number: T) {
            var littleEndian = number.littleEndian
            withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: "RIFF".utf8); append(UInt32(36 + 2 * sampleCount))
        data.append(contentsOf: "WAVEfmt ".utf8); append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(UInt32(16000)); append(UInt32(32000)); append(UInt16(2)); append(UInt16(16))
        data.append(contentsOf: "data".utf8); append(UInt32(2 * sampleCount))
        for index in 0 ..< sampleCount {
            let progress = Double(index) / Double(sampleCount - 1)
            let envelope = sin(.pi * progress)
            let tone = sin(2 * .pi * 520 * Double(index) / 16000)
            append(Int16(4200 * tone * envelope * envelope))
        }
        return data
    }
}

extension RealtimeVoiceCall {
    func sendStartWithConnectingCue(_ event: [String: Any], startID: String, identifier: String, epoch: UUID) {
        guard let token, foreground() else { fail(); return }
        var sent = false
        let send: (Bool) -> Void = { [weak self] usable in
            guard let self, id == identifier, lifecycleEpoch == epoch, !sent else { return }
            sent = true
            guard usable, foreground() else { fail(); return }
            var event = event
            event["event_id"] = startID
            liveStartID = startID
            socket.send(event)
        }
        if let connectingCue {
            connectingCue.play(ownership: ownership, token: token, finished: send)
        } else {
            send(true)
        }
    }
}
