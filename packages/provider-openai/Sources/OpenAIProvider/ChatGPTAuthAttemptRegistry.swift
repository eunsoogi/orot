import Foundation

/// Keeps each system-auth callback bound to the login attempt that created it.
/// The owning app session serializes access on its main actor.
public struct ChatGPTAuthAttemptRegistry: Sendable {
    private var activeAttempt: UUID?

    public init() {}

    /// Allows only one active browser attempt per auth-session owner.
    public mutating func begin() -> UUID? {
        guard activeAttempt == nil else { return nil }
        let attempt = UUID()
        activeAttempt = attempt
        return attempt
    }

    /// Clears the matching attempt once; delayed callbacks from older attempts are ignored.
    @discardableResult
    public mutating func finish(_ attempt: UUID) -> Bool {
        guard activeAttempt == attempt else { return false }
        activeAttempt = nil
        return true
    }
}
