#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation

    /// Test transport only: exercise the production socket queue with no URLSession.
    final class ComposedCanonicalFixtureTransport: RealtimeVoiceSocketTask {
        private var incoming: (@Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)?
        private var queued: [[String: Any]] = []
        private(set) var submitted: [[String: Any]] = []
        private(set) var openCount = 0
        private(set) var closed = false
        let session = "canonical-open-fixture-session"
        var resultFrames: [[String: Any]] {
            submitted.filter { ["response.item.create", "response.create"].contains($0["type"] as? String ?? "") }
        }

        func resume() {
            openCount += 1
        }

        func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void) {
            guard !closed, case let .string(text) = message,
                  let event = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
            else {
                completionHandler(URLError(.cancelled))
                return
            }
            submitted.append(event)
            completionHandler(nil)
            guard let eventID = event["event_id"] as? String else { return }
            switch event["type"] as? String {
            case "session.start":
                feed(["type": "session.started", "client_event_id": eventID,
                      "session": ["id": session, "model": "gpt-live-1.1", "status": "active",
                                  "expires_at": Date().timeIntervalSince1970 + 180]])
            case "session.input_audio.unmute":
                feed(["type": "session.input_audio.unmuted", "client_event_id": eventID])
            default:
                break
            }
        }

        func receive(completionHandler: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {
            incoming = completionHandler
            flush()
        }

        func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {
            incoming = nil
            queued.removeAll()
            closed = true
        }

        func delegate() {
            feed(["type": "session.delegation.created", "event_id": "created", "offset_ms": 0,
                  "delegation": ["type": "delegation", "target": "responses", "id": "fixture-delegation",
                                 "response_id": "fixture-response"]])
            response("response-created", ["type": "response.created", "response": ["id": "fixture-response"]])
            response("tool", ["type": "response.output_item.done",
                              "item": ["type": "function_call", "name": "local-health-context", "call_id": "fixture-function",
                                       "arguments": #"{"days":7,"topics":["measurements"]}"#]])
            response("done", ["type": "response.completed", "response": ["id": "fixture-response", "status": "completed"]])
        }

        private func response(_ id: String, _ event: [String: Any]) {
            feed(["type": "response.event", "event_id": id, "delegation_id": "fixture-delegation", "event": event])
        }

        private func feed(_ event: [String: Any]) {
            queued.append(event)
            flush()
        }

        private func flush() {
            guard !closed, let incoming, !queued.isEmpty,
                  let bytes = try? JSONSerialization.data(withJSONObject: queued.removeFirst())
            else { return }
            self.incoming = nil
            incoming(.success(.string(String(decoding: bytes, as: UTF8.self))))
        }
    }
#endif
