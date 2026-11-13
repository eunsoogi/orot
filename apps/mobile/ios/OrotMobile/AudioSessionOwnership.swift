import AVFoundation
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
         setActive: @escaping (Bool) throws -> Void) {
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
