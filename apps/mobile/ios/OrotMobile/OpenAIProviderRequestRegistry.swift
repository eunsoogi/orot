import Foundation
import OpenAIProvider

/// Owns bridge tasks while the package gate serializes their event and sign-out lifecycles.
final class OpenAIProviderRequestRegistry {
    final class Slot {
        let ticket: ChatGPTRequestLifecycleGate.Ticket
        var task: Task<Void, Never>?
        var steering: ChatGPTSteerableResponse?
        fileprivate let photoDelivery: PhotoDelivery?
        fileprivate let enqueue: (Delivery) -> Void

        var id: String {
            ticket.id
        }

        var issuedClientID: String {
            ticket.issuedClientID
        }

        fileprivate init(ticket: ChatGPTRequestLifecycleGate.Ticket, photoDelivery: PhotoDelivery?, enqueue: @escaping (Delivery) -> Void) {
            self.ticket = ticket
            self.photoDelivery = photoDelivery
            self.enqueue = enqueue
        }

        func event(_ packet: NSDictionary) {
            // Never let a mutable progress packet acquire a terminal tag after queue admission.
            guard let snapshot = packet.copy() as? NSDictionary else { return }
            switch snapshot["type"] as? String {
            case "steering_ready", "text_snapshot", "steering", "response_started", "text_delta", "tool_call":
                enqueue(.event(snapshot))
            default: break
            }
        }
    }

    /// Only a typed native response can schedule a successful terminal. Bridge dictionaries do not grant it.
    enum Terminal {
        case completed(ChatGPTResponsesResult)
        case failed(Error)

        fileprivate var packet: [String: Any] {
            switch self {
            case let .completed(response):
                var packet: [String: Any] = [
                    "type": "completed",
                    "text": response.text,
                    "toolCalls": response.toolCalls.map(OpenAIProviderRequestRegistry.toolPacket),
                    "continuationItems": response.continuationItems,
                ]
                if let usage = response.usage {
                    packet["usage"] = usage.nativePayload
                }
                // Public-search output carries provider citations, not fetched originals.
                if let search = response.webSearch {
                    packet["webSearch"] = [
                        "callCount": search.callCount,
                        "citations": search.citations.map { ["url": $0.url, "title": $0.title] },
                    ]
                }
                return packet
            case let .failed(error):
                return ["type": "failed", "error": OpenAIProviderErrorDetails.make(error)]
            }
        }
    }

    fileprivate enum Delivery {
        case event(NSDictionary)
        case terminal(Terminal)

        var isTerminal: Bool {
            if case .terminal = self {
                return true
            }
            return false
        }

        var packet: NSDictionary {
            switch self {
            case let .event(packet): packet
            case let .terminal(terminal): terminal.packet as NSDictionary
            }
        }
    }

    /// Photo Stop can still win after the provider reserves its terminal but before the bridge enqueue.
    /// This is an enqueue fence only; it is not a JavaScript sink or persistent-media receipt.
    fileprivate final class PhotoDelivery {
        private let lock = NSLock()
        private var retired = false

        func retire() {
            lock.withLock { retired = true }
        }

        func deliver(_ enqueue: () -> Void) {
            lock.withLock {
                if !retired {
                    enqueue()
                }
            }
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
        photo: Bool = false,
        emit: @escaping (String, NSDictionary) -> Void,
    ) -> Registration {
        lock.lock()
        defer { lock.unlock() }
        switch lifecycle.register(requestID, issuedClientID: issuedClientID) {
        case let .accepted(ticket):
            let photoDelivery = photo ? PhotoDelivery() : nil
            let slot = Slot(ticket: ticket, photoDelivery: photoDelivery) { [weak self] delivery in
                DispatchQueue.main.async { [weak self] in
                    guard let self,
                          lifecycle.deliver(ticket, terminal: delivery.isTerminal, emit: {
                              let enqueue = { emit(requestID, delivery.packet) }
                              if let photoDelivery {
                                  photoDelivery.deliver(enqueue)
                              } else {
                                  enqueue()
                              }
                          })
                    else { return }
                    if delivery.isTerminal {
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

        activeRequests.forEach { $0.steering?.cancel(); $0.task?.cancel() }
        return activeRequests
    }

    func finishSignOut(for issuedClientID: String) {
        lock.lock()
        lifecycle.finishSignOut(for: issuedClientID)
        lock.unlock()
    }

    func cancel(requestID: String) -> Task<Void, Never>? {
        lock.lock()
        guard let slot = requests[requestID] else {
            lock.unlock()
            return nil
        }
        // Release the per-photo lock before claiming the lifecycle gate; queued delivery takes them in the other order.
        slot.photoDelivery?.retire()
        guard lifecycle.cancel(slot.ticket) else {
            lock.unlock()
            return nil
        }
        requests.removeValue(forKey: requestID)
        slot.steering?.cancel()
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

    /// Shares the request lock so a late socket cannot register after cancellation or sign-out.
    func attachSteering(_ handle: ChatGPTSteerableResponse, to slot: Slot) -> Bool {
        let attached = lock.withLock {
            guard requests[slot.id] === slot, lifecycle.isActive(slot.ticket) else { return false }
            slot.steering = handle
            return true
        }
        if !attached {
            handle.cancel()
        }
        return attached
    }

    func steering(requestID: String) -> ChatGPTSteerableResponse? {
        lock.withLock {
            guard let slot = requests[requestID], lifecycle.isActive(slot.ticket) else { return nil }
            return slot.steering
        }
    }

    func isActive(_ slot: Slot) -> Bool {
        lifecycle.isActive(slot.ticket)
    }

    func finish(_ slot: Slot, _ terminal: Terminal) {
        if lifecycle.reserveTerminal(slot.ticket) {
            slot.enqueue(.terminal(terminal))
        }
    }

    private func remove(_ ticket: ChatGPTRequestLifecycleGate.Ticket) {
        lock.lock()
        if requests[ticket.id]?.ticket === ticket {
            requests.removeValue(forKey: ticket.id)
        }
        lock.unlock()
    }

    static func toolPacket(_ toolCall: ChatGPTResponsesFunctionCall) -> [String: String] {
        ["id": toolCall.id, "name": toolCall.name, "arguments": toolCall.argumentsJSON]
    }
}
