import Foundation

/// Keeps request validation and native event submission at one synchronization boundary.
enum LocalE5ProgressDelivery {
    static func submit(lock: NSLock, isActive: () -> Bool, emit: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        // Submission only enqueues a JS event; keeping the lock here prevents cancellation from reusing its request ID first.
        if isActive() {
            emit()
        }
    }
}

/// The public request ends synchronously, before actor cleanup is scheduled. All access to this cross-task flag uses the lock.
final class LocalE5PreparationCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }

    func check() throws {
        if isCancelled {
            throw CancellationError()
        }
    }
}
