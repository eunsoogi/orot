import Foundation

/// Darwin notifications only wake the host; protected database readback remains the oracle.
final class BackgroundCommitSignal {
    private let lock = NSLock()
    private var value = false
    private var finished = false
    func receive(_ success: Bool) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        value = success
        lock.unlock()
    }

    var succeeded: Bool {
        lock.lock(); defer { lock.unlock() }; return value
    }

    var received: Bool {
        lock.lock(); defer { lock.unlock() }; return finished
    }
}
