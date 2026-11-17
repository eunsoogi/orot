import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesPendingPoolTests: XCTestCase {
    func testPendingSteeringNeverReturnsSocketToPool() async throws {
        let pool = ResponsesConnectionPool()
        let key = ResponsesConnectionPool.Key(scope: "scope", account: "account", model: "model", credential: "synthetic")
        let socket = PendingSocket()
        let lease = pool.lease(socket, generation: pool.take(key).0)
        let handle = ChatGPTSteerableResponse(connection: lease, initialRequest: Data("{}".utf8))
        for try await event in await handle.events() {
            if event == .ready {
                try await handle.steer(submissionID: "local", text: "synthetic update")
            }
        }
        // Stream termination may wake its consumer before the producer's deferred close.
        for _ in 0 ..< 100 where !socket.closed {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTAssertTrue(socket.closed)
        XCTAssertNil(pool.take(key).1)
    }
}

private final class PendingSocket: ResponsesWebSocketConnection, @unchecked Sendable {
    private let lock = NSLock()
    private var frames = [Data]()
    private var sent = 0
    private var isClosed = false
    var closed: Bool {
        lock.withLock { isClosed }
    }

    func send(_: Data) async throws {
        lock.withLock {
            sent += 1
            let values = sent == 1 ? [
                #"{"type":"response.created","response":{"id":"original","status":"in_progress"}}"#,
            ] : [
                #"{"type":"response.completed","response":{"id":"original","status":"completed","output":[]}}"#,
                #"{"type":"response.steer.accepted","steer":{"id":"server","previous_response_id":"original"}}"#,
                #"{"type":"response.steer.pending","steer":{"id":"server","previous_response_id":"original"}}"#,
            ]
            frames += values.map { Data($0.utf8) }
        }
    }

    func receive() async throws -> Data {
        while true {
            let next = try lock.withLock { () throws -> Data? in
                guard !isClosed else { throw CancellationError() }
                return frames.isEmpty ? nil : frames.removeFirst()
            }
            if let next {
                return next
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }

    func close() {
        lock.withLock { isClosed = true }
    }
}
