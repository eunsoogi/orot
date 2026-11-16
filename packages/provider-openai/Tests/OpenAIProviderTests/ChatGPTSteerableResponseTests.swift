import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTSteerableResponseTests: XCTestCase {
    func testSocketKeepsOriginalAndSuccessorOnOneConnection() async throws {
        let connection = ScriptedSteeringSocket()
        let handle = ChatGPTSteerableResponse(connection: connection, initialRequest: Data(#"{"type":"response.create"}"#.utf8))
        var observed = [ChatGPTSteerableEvent]()
        for try await event in await handle.events() {
            observed.append(event)
            if event == .ready {
                try await handle.steer(submissionID: "local", text: "Be concise")
            }
        }
        XCTAssertEqual(connection.sentTypes, ["response.create", "response.steer"])
        XCTAssertTrue(connection.isClosed)
        XCTAssertEqual(Array(observed.prefix(4)), [.ready,
                                                   .steering(submissionID: "local", status: "accepted", steerID: "server"),
                                                   .steering(submissionID: "local", status: "applied", steerID: "server"), .textSnapshot("")])
        guard case .response(.completed) = observed.last else { return XCTFail("Expected successor completion") }
    }

    func testSynchronousCancellationClosesSocketAndRejectsLateSubmission() async throws {
        let connection = ScriptedSteeringSocket()
        let handle = ChatGPTSteerableResponse(connection: connection, initialRequest: Data(#"{"type":"response.create"}"#.utf8))
        do {
            for try await event in await handle.events() {
                if event == .ready {
                    handle.cancel()
                    do {
                        try await handle.steer(submissionID: "late", text: "Do not send")
                        XCTFail("Closed socket must reject")
                    } catch {}
                }
            }
            XCTFail("Cancelled stream must not complete normally")
        } catch {}
        XCTAssertTrue(connection.isClosed)
        XCTAssertEqual(connection.sentTypes, ["response.create"])
    }
}

/// Synthetic socket with no URLSession, credentials, user data or outbound network.
private final class ScriptedSteeringSocket: ResponsesWebSocketConnection, @unchecked Sendable {
    private let lock = NSLock()
    private var frames = [Data]()
    private var sent = [String]()
    private var closed = false
    var sentTypes: [String] {
        lock.withLock { sent }
    }

    var isClosed: Bool {
        lock.withLock { closed }
    }

    func send(_ data: Data) async throws {
        let value = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let type = value["type"] as! String
        try lock.withLock {
            guard !closed else { throw CancellationError() }
            sent.append(type)
            if type == "response.create" {
                frames.append(Data(#"{"type":"response.created","response":{"id":"original"}}"#.utf8))
            } else {
                frames += [
                    #"{"type":"response.steer.accepted","steer":{"id":"server","previous_response_id":"original"}}"#,
                    #"{"type":"response.incomplete","response":{"id":"original","incomplete_details":{"reason":"steered"}}}"#,
                    #"{"type":"response.created","response":{"id":"successor","previous_response_id":"original"}}"#,
                    #"{"type":"response.completed","response":{"id":"successor","status":"completed","output":[]}}"#,
                ].map { Data($0.utf8) }
            }
        }
    }

    func receive() async throws -> Data {
        while true {
            let next: Data? = try lock.withLock {
                guard !closed else { throw CancellationError() }
                return frames.isEmpty ? nil : frames.removeFirst()
            }
            if let next {
                return next
            }
            try await Task.sleep(for: .milliseconds(1))
        }
    }

    func close() {
        lock.withLock { closed = true }
    }
}
