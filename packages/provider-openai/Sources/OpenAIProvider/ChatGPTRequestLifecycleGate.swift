import Foundation

/// Serializes account-scoped response delivery with cancellation during sign-out.
public final class ChatGPTRequestLifecycleGate: @unchecked Sendable {
    public final class Ticket: @unchecked Sendable {
        public let id: String
        public let issuedClientID: String
        fileprivate let generation: UInt64
        fileprivate var cancelled = false
        fileprivate var terminalPending = false

        fileprivate init(id: String, issuedClientID: String, generation: UInt64) {
            self.id = id
            self.issuedClientID = issuedClientID
            self.generation = generation
        }
    }

    public enum Registration {
        case accepted(Ticket)
        case duplicate
        case signingOut
    }

    private let lock = NSLock()
    private var tickets: [String: Ticket] = [:]
    private var signOutInProgress = Set<String>()
    private var generations: [String: UInt64] = [:]

    public init() {}

    public func register(_ requestID: String, issuedClientID: String) -> Registration {
        lock.lock()
        defer { lock.unlock() }
        guard !signOutInProgress.contains(issuedClientID) else { return .signingOut }
        guard tickets[requestID] == nil else { return .duplicate }

        let ticket = Ticket(
            id: requestID,
            issuedClientID: issuedClientID,
            generation: generations[issuedClientID, default: 0],
        )
        tickets[requestID] = ticket
        return .accepted(ticket)
    }

    public func isActive(_ ticket: Ticket) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return tickets[ticket.id] === ticket && !ticket.cancelled && !ticket.terminalPending
    }

    /// Reserve the one terminal packet while keeping the ticket visible to sign-out.
    public func reserveTerminal(_ ticket: Ticket) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard tickets[ticket.id] === ticket, !ticket.cancelled, !ticket.terminalPending else {
            return false
        }
        ticket.terminalPending = true
        return true
    }

    /// Serializes queued packet emission with sign-out while preserving the main queue's packet order.
    public func deliver(_ ticket: Ticket, terminal: Bool, emit: () -> Void) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard tickets[ticket.id] === ticket,
              generations[ticket.issuedClientID, default: 0] == ticket.generation,
              !signOutInProgress.contains(ticket.issuedClientID),
              !ticket.cancelled
        else {
            return false
        }
        if terminal {
            guard ticket.terminalPending else { return false }
            emit()
            tickets.removeValue(forKey: ticket.id)
        } else {
            // Earlier main-queue deltas may drain after completion reserves its packet; preserve them.
            emit()
        }
        return true
    }

    public func beginSignOut(for issuedClientID: String) -> [Ticket]? {
        lock.lock()
        defer { lock.unlock() }
        guard signOutInProgress.insert(issuedClientID).inserted else { return nil }
        generations[issuedClientID, default: 0] += 1
        let activeTickets = tickets.values.filter { $0.issuedClientID == issuedClientID }
        for ticket in activeTickets {
            ticket.cancelled = true
            tickets.removeValue(forKey: ticket.id)
        }
        return activeTickets
    }

    public func finishSignOut(for issuedClientID: String) {
        lock.lock()
        signOutInProgress.remove(issuedClientID)
        lock.unlock()
    }

    public func cancel(_ ticket: Ticket) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard tickets[ticket.id] === ticket, !ticket.cancelled, !ticket.terminalPending else {
            return false
        }
        ticket.cancelled = true
        tickets.removeValue(forKey: ticket.id)
        return true
    }
}
