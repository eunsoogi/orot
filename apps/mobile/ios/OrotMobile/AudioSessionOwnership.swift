import AVFoundation
import Darwin
import Foundation

/// Process-wide exclusive reservation. Session mutations and token checks share one lock.
final class AudioSessionOwnership {
    static let shared = AudioSessionOwnership()
    struct Token: Equatable { fileprivate let id = UUID() }
    enum Failure: Error { case busy, stale }
    private let lock = NSLock()
    private var owner: Token?
    private var active = false
    private let configure: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions) throws -> Void
    private let setActive: (Bool) throws -> Void

    convenience init(session: AVAudioSession = .sharedInstance()) {
        self.init(configure: { try session.setCategory($0, mode: $1, options: $2) }, setActive: {
            try session.setActive($0, options: $0 ? [] : .notifyOthersOnDeactivation)
        })
    }

    init(configure: @escaping (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions) throws -> Void,
         setActive: @escaping (Bool) throws -> Void)
    {
        self.configure = configure
        self.setActive = setActive
    }

    func reserve() throws -> Token {
        lock.lock()
        defer { lock.unlock() }
        guard owner == nil else { throw Failure.busy }
        let token = Token()
        owner = token
        return token
    }

    func activate(_ token: Token, category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions = []) throws {
        lock.lock()
        defer { lock.unlock() }
        guard owner == token else { throw Failure.stale }
        try configure(category, mode, options)
        // Activation failure can leave system state uncertain; require successful deactivation before release.
        active = true
        try setActive(true)
    }

    /// CallKit activates the session. Configure only; never start microphone audio before its callback.
    func prepareSystemCall(_ token: Token) throws {
        lock.lock()
        defer { lock.unlock() }
        guard owner == token else { throw Failure.stale }
        try configure(.playAndRecord, .voiceChat, [.defaultToSpeaker, .allowBluetoothHFP])
    }

    /// Track the externally activated session so ordinary fail-closed release still deactivates it.
    func systemCallActivated(_ token: Token) throws {
        lock.lock()
        defer { lock.unlock() }
        guard owner == token else { throw Failure.stale }
        active = true
    }

    /// A suspended owner keeps its reservation and must explicitly resume.
    func suspend(_ token: Token) throws {
        lock.lock()
        defer { lock.unlock() }
        guard owner == token else { throw Failure.stale }
        if active {
            try setActive(false)
            active = false
        }
    }

    /// Failure to deactivate preserves ownership so another feature cannot take over unsafely.
    func release(_ token: Token) throws {
        lock.lock()
        defer { lock.unlock() }
        guard owner == token else { throw Failure.stale }
        if active {
            try setActive(false)
            active = false
        }
        owner = nil
    }
}

/// Main-queue owned, one-shot display receipt for a logical call with started audio.
final class VoiceConnectedDuration {
    private let nowNanoseconds: () -> UInt64
    private var ready: (callID: String, atNanoseconds: UInt64)?
    private var terminal: (callID: String, seconds: Int)?

    /// Darwin's continuous clock is monotonic through sleep and available before iOS 16.
    init(nowNanoseconds: @escaping () -> UInt64 = { clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) }) {
        self.nowNanoseconds = nowNanoseconds
    }

    func begin() {
        ready = nil
        terminal = nil
    }

    func markReady(_ callID: String) {
        guard ready == nil, terminal == nil, !callID.isEmpty else { return }
        ready = (callID, nowNanoseconds())
    }

    func markStopped(_ callID: String) {
        guard let started = ready, started.callID == callID else { return }
        ready = nil
        let end = nowNanoseconds()
        guard end >= started.atNanoseconds else { return }
        let elapsedNanoseconds = end - started.atNanoseconds
        guard let seconds = Int(exactly: elapsedNanoseconds / 1_000_000_000) else { return }
        terminal = (callID, seconds)
    }

    func take(_ callID: String) -> [String: Any]? {
        guard let receipt = terminal, receipt.callID == callID else { return nil }
        terminal = nil
        return ["callId": receipt.callID, "durationSeconds": receipt.seconds]
    }

    func startDuplex(_ callID: String, audio: VoiceDuplexAudioPort, input: @escaping (AVAudioPCMBuffer) -> Void) throws {
        try audio.start(input: input)
        markReady(callID)
    }

    func stopDuplex(_ callID: String, audio: VoiceDuplexAudioPort) {
        markStopped(callID)
        audio.stop()
    }
}
