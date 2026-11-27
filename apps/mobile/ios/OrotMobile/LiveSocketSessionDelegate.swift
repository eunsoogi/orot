import Foundation

/// A redirect must never carry a user's BYOK credential to a second destination.
final class LiveSocketSessionDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_: URLSession, task _: URLSessionTask, willPerformHTTPRedirection _: HTTPURLResponse,
                    newRequest _: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void)
    {
        completionHandler(nil)
    }
}

/// Network Receive and local Send completion are independently posted to the main queue.
/// An exact early successor starts the hold. Later managed lifecycle frames preserve
/// wire order and remain untrusted until validated by the original bridge.
struct LiveContinuationIngress {
    enum Admission { case forward, deferred, overflow }
    private var owner: (command: String, delegation: String)?
    private var staged: [[String: Any]] = []
    private var bytes = 0

    mutating func begin(_ write: RealtimeSocketWrite) {
        guard write.finalResultContinuation, let command = write.managedEventID,
              let delegation = write.permit?.ticket?.continuationDelegation
        else { return }
        self = Self()
        owner = (command, delegation)
    }

    mutating func admit(_ event: [String: Any], message: URLSessionWebSocketTask.Message) -> Admission {
        guard let owner, event["type"] as? String == "response.event", let nested = event["event"] as? [String: Any],
              let type = nested["type"] as? String,
              ["response.created", "response.output_item.done", "response.completed", "response.failed", "response.incomplete"].contains(type)
        else { return .forward }
        // Do not move a conflicting item ahead of its held created frame. The
        // spent predecessor could ignore it, letting later matching events splice.
        if staged.isEmpty {
            guard type == "response.created", event["delegation_id"] as? String == owner.delegation,
                  event["client_event_id"] as? String == owner.command
            else { return .forward }
        }
        // The original message gives a size bound without re-encoding provider data.
        let count: Int
        switch message {
        case let .data(value): count = value.count
        case let .string(value): count = value.utf8.count
        @unknown default: return .overflow
        }
        guard staged.count < 16, bytes + count <= 64 * 1024 else {
            self = Self()
            return .overflow
        }
        bytes += count
        staged.append(event)
        return .deferred
    }

    /// Reprove the same socket after every callback, which can stop it synchronously.
    static func replay(_ events: [[String: Any]], owner: () -> Bool, receive: (([String: Any]) -> Void)?) {
        for event in events {
            guard owner() else { return }
            receive?(event)
        }
    }

    mutating func complete(_ write: RealtimeSocketWrite) -> [[String: Any]] {
        guard let owner, write.managedEventID == owner.command, write.finalResultContinuation else { return [] }
        defer { self = Self() }
        return staged
    }
}

/// Capture and decode the next receive at its existing main-queue boundary.
enum LiveSocketReadPump {
    struct Receiver: @unchecked Sendable {
        let owner: () -> Bool
        let onMain: (([String: Any], URLSessionWebSocketTask.Message)?) -> Void
    }

    static func receive(_ task: RealtimeVoiceSocketTask, owner: @escaping () -> Bool, onMain: @escaping (([String: Any], URLSessionWebSocketTask.Message)?) -> Void) {
        let handler = Receiver(owner: owner, onMain: onMain)
        task.receive { result in
            DispatchQueue.main.async {
                guard handler.owner() else { return }
                guard case let .success(message) = result, let event = RealtimeVoiceSocket.decodeSocketEvent(message)
                else { handler.onMain(nil); return }
                handler.onMain((event, message))
            }
        }
    }
}
