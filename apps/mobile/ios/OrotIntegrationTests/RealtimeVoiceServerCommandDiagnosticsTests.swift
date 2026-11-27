import Foundation
@testable import Orot
import XCTest

#if OROT_TESTS && targetEnvironment(simulator)
    /// Real socket queue and receive callbacks, with no network, accounts or microphone.
    @MainActor
    final class RealtimeVoiceServerCommandDiagnosticsTests: OrotFailFastTestCase {
        func testServerOriginsFollowOnlyHandedCommandsInTheCurrentSocket() async throws {
            let harness = Harness()
            let socket = harness.socket
            defer { socket.close() }
            let output = UUID().uuidString, continuation = UUID().uuidString
            let ordinary = UUID().uuidString
            socket.send(["type": "session.update", "event_id": ordinary])
            harness.queue(output: output, continuation: continuation)
            let first = harness.first
            XCTAssertEqual(first.writes, ["session.update"])
            try await first.input(Self.error(output))
            try await first.input(Self.error(ordinary))
            XCTAssertEqual(harness.stages, [.liveServerUnmatchedError, .liveServerUnmatchedError])

            try await first.complete()
            XCTAssertEqual(first.writes, ["session.update", "response.item.create"])
            try await first.input(Self.error(output))
            XCTAssertEqual(harness.stages.last, .liveServerFunctionOutputError)
            try await first.input(Self.error(continuation))
            XCTAssertEqual(harness.stages.last, .liveServerUnmatchedError)

            try await first.complete()
            XCTAssertEqual(first.writes.last, "response.create")
            try await first.input(Self.error(continuation, outer: continuation))
            XCTAssertEqual(harness.stages.last, .liveServerContinuationError)
            try await first.input(Self.error(output, outer: continuation))
            XCTAssertEqual(harness.stages.last, .liveServerUnattributedError)
            try await first.input(Self.error(nil, outer: output))
            XCTAssertEqual(harness.stages.last, .liveServerUnattributedError)
            try await first.input(Self.error("synthetic-invalid-echo"))
            XCTAssertEqual(harness.stages.last, .liveServerUnattributedError)

            let reportCount = harness.stages.count
            try await first.input(["type": "response.event", "event": Self.error(output)])
            XCTAssertEqual(harness.stages.count, reportCount, "Nested failures already have their ordinary lifecycle owner.")
            XCTAssertEqual(harness.forwarded.count, 9)
            let forwarded = try XCTUnwrap(harness.forwarded[1]["error"] as? [String: Any])
            XCTAssertEqual(forwarded["message"] as? String, "synthetic-error-text")

            // The existing graceful-close barrier suppresses ordinary receive work unchanged.
            socket.finishLive(sessionID: "synthetic-session")
            try await first.input(Self.error(output))
            XCTAssertEqual(harness.stages.count, reportCount)
            XCTAssertEqual(harness.forwarded.count, 9)
            let stale = try XCTUnwrap(first.receiver)
            socket.close()
            socket.open(model: "gpt-live-1.1", key: "unused-networkless")
            stale(.success(.data(try JSONSerialization.data(withJSONObject: Self.error(output)))))
            await NetworklessTask.drain()
            XCTAssertEqual(harness.stages.count, reportCount)
            XCTAssertEqual(harness.forwarded.count, 9)
            try await harness.replacement.input(Self.error(output))
            XCTAssertEqual(harness.stages.last, .liveServerUnmatchedError)
            XCTAssertEqual(harness.forwarded.count, 10)
            XCTAssertTrue(harness.replacement.writes.isEmpty)
        }

        func testOriginWindowEvictsOldCommandsAndRejectsAmbiguousEchoes() async throws {
            let harness = Harness()
            defer { harness.socket.close() }
            let first = harness.first
            let oldest = UUID().uuidString
            var boundary = "", recent = ""
            for index in 0 ..< 9 {
                let next = index == 0 ? oldest : UUID().uuidString
                harness.queue(output: next, continuation: UUID().uuidString)
                try await first.complete()
                try await first.complete()
                if index == 1 { boundary = next }
                recent = next
            }
            try await first.input(Self.error(oldest))
            try await first.input(Self.error(boundary))
            try await first.input(Self.error(recent))
            XCTAssertEqual(harness.stages, [.liveServerUnmatchedError, .liveServerFunctionOutputError, .liveServerFunctionOutputError])

            // The same literal UUID in two handed commands must not be guessed.
            harness.queue(output: UUID().uuidString, continuation: recent)
            try await first.complete()
            try await first.complete()
            try await first.input(Self.error(recent))
            XCTAssertEqual(harness.stages.last, .liveServerUnmatchedError)
            XCTAssertEqual(harness.forwarded.count, 4)
            XCTAssertEqual(first.writes.count, 20)
        }

        private static func error(_ id: String?, outer: String? = nil) -> [String: Any] {
            var details: [String: Any] = ["message": "synthetic-error-text"]
            details["client_event_id"] = id
            var event: [String: Any] = ["type": "error", "event_id": "synthetic-server-event", "error": details]
            event["client_event_id"] = outer
            return event
        }
    }

    private final class Harness {
        let first = NetworklessTask(), replacement = NetworklessTask()
        private let authority = LiveNativeResultDispatchAuthority()
        var stages: [VoiceSystemCallLifecycle.DiagnosticStage] = []
        var forwarded: [[String: Any]] = []
        lazy var socket: RealtimeVoiceSocket = {
            let endpoint = RealtimeVoiceSocketEndpoint(networklessTask: { [unowned self] in
                first.resumed ? replacement : first
            }, reportServerCommand: { [weak self] stage in self?.stages.append(stage) })
            let result = RealtimeVoiceSocket(endpoint: endpoint)
            result.received = { [weak self] event in self?.forwarded.append(event) }
            result.failed = { XCTFail("An ordinary decoded server error must not change transport failure behavior.") }
            result.open(model: "gpt-live-1.1", key: "unused-networkless")
            return result
        }()

        func queue(output: String, continuation: String) {
            let ticket = authority.begin(call: "synthetic-owner", challenge: UUID().uuidString)
            XCTAssertTrue(ticket.claim())
            XCTAssertTrue(ticket.bind { _ in })
            let item = ["type": "function_call_output", "call_id": "synthetic-call", "output": "fixture"]
            XCTAssertTrue(socket.sendTicketedToolFrames([
                ["type": "response.item.create", "event_id": output, "item": item],
                ["type": "response.create", "event_id": continuation],
            ], current: { true }, ticket: ticket))
        }
    }

    private final class NetworklessTask: RealtimeVoiceSocketTask {
        typealias Receiver = @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void
        var resumed = false
        var receiver: Receiver?
        private var completions: [@Sendable (Error?) -> Void] = []
        private(set) var writes: [String] = []

        func resume() { resumed = true }
        func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void) {
            writes.append(RealtimeVoiceSocket.decodeSocketEvent(message)?["type"] as? String ?? "malformed")
            completions.append(completionHandler)
        }

        func receive(completionHandler: @escaping Receiver) { receiver = completionHandler }
        func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {}

        func input(_ event: [String: Any]) async throws {
            let callback = try XCTUnwrap(receiver)
            receiver = nil
            callback(.success(.data(try JSONSerialization.data(withJSONObject: event))))
            await Self.drain()
        }

        func complete() async throws {
            let callback = try XCTUnwrap(completions.first)
            completions.removeFirst()
            callback(nil)
            await Self.drain()
        }

        static func drain() async {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                DispatchQueue.main.async { continuation.resume() }
            }
        }
    }
#endif
