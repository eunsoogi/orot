import Foundation
import OpenAIProvider

/// Owns bridge tasks while the package gate serializes their event and sign-out lifecycles.
final class OpenAIProviderRequestRegistry {
    final class Slot {
        let ticket: ChatGPTRequestLifecycleGate.Ticket
        var task: Task<Void, Never>?
        let event: (NSDictionary) -> Void

        var id: String {
            ticket.id
        }

        var issuedClientID: String {
            ticket.issuedClientID
        }

        init(ticket: ChatGPTRequestLifecycleGate.Ticket, event: @escaping (NSDictionary) -> Void) {
            self.ticket = ticket
            self.event = event
        }
    }

    enum Registration {
        case accepted(Slot)
        case duplicate
        case signingOut
    }

    private let lock = NSLock()
    private let lifecycle = ChatGPTRequestLifecycleGate()
    private var requests: [String: Slot] = [:]

    func register(
        _ requestID: String,
        issuedClientID: String,
        emit: @escaping (String, NSDictionary) -> Void,
    ) -> Registration {
        lock.lock()
        defer { lock.unlock() }
        switch lifecycle.register(requestID, issuedClientID: issuedClientID) {
        case let .accepted(ticket):
            let slot = Slot(ticket: ticket) { [weak self] packet in
                let terminal = Self.isTerminalPacket(packet)
                DispatchQueue.main.async { [weak self] in
                    guard let self,
                          lifecycle.deliver(ticket, terminal: terminal, emit: {
                              emit(requestID, packet)
                          })
                    else { return }
                    if terminal {
                        remove(ticket)
                    }
                }
            }
            requests[requestID] = slot
            return .accepted(slot)
        case .duplicate: return .duplicate
        case .signingOut: return .signingOut
        }
    }

    func beginSignOut(for issuedClientID: String) -> [Slot]? {
        lock.lock()
        guard let tickets = lifecycle.beginSignOut(for: issuedClientID) else {
            lock.unlock()
            return nil
        }
        let activeRequests = tickets.compactMap { requests.removeValue(forKey: $0.id) }
        lock.unlock()

        activeRequests.forEach { $0.task?.cancel() }
        return activeRequests
    }

    func finishSignOut(for issuedClientID: String) {
        lock.lock()
        lifecycle.finishSignOut(for: issuedClientID)
        lock.unlock()
    }

    func cancel(requestID: String) -> Task<Void, Never>? {
        lock.lock()
        guard let slot = requests[requestID], lifecycle.cancel(slot.ticket) else {
            lock.unlock()
            return nil
        }
        requests.removeValue(forKey: requestID)
        slot.task?.cancel()
        let task = slot.task
        lock.unlock()
        return task
    }

    func attach(_ task: Task<Void, Never>, to slot: Slot) {
        lock.lock()
        let isCurrent = requests[slot.id] === slot
        let isActive = isCurrent && lifecycle.isActive(slot.ticket)
        if isActive {
            slot.task = task
        }
        lock.unlock()
        if !isActive {
            task.cancel()
        }
    }

    func isActive(_ slot: Slot) -> Bool {
        lifecycle.isActive(slot.ticket)
    }

    func finish(_ slot: Slot) -> Bool {
        lifecycle.reserveTerminal(slot.ticket)
    }

    private func remove(_ ticket: ChatGPTRequestLifecycleGate.Ticket) {
        lock.lock()
        if requests[ticket.id]?.ticket === ticket {
            requests.removeValue(forKey: ticket.id)
        }
        lock.unlock()
    }

    private static func isTerminalPacket(_ packet: NSDictionary) -> Bool {
        guard let type = packet["type"] as? String else { return false }
        return type == "completed" || type == "failed"
    }
}
