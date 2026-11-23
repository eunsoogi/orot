import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesConnectionPoolTests: XCTestCase {
    private func key(_ scope: String = "scope", _ account: String = "account", _ model: String = "model", _ credential: String = "synthetic") -> ResponsesConnectionPool.Key {
        .init(scope: scope, account: account, model: model, credential: credential)
    }

    func testCompletedResponseReusesSocketAndOldCleanupCannotCloseNewLease() async throws {
        let pool = ResponsesConnectionPool()
        let connection = CompletingSocket()
        let first = pool.lease(connection, generation: pool.take(key()).0)
        let response = ChatGPTSteerableResponse(connection: first, initialRequest: Data("{}".utf8))
        for try await _ in await response.events() {}
        let reused = try XCTUnwrap(pool.take(key()).1)
        let second = pool.lease(reused, generation: pool.take(key()).0)
        first.close()
        await response.close()
        XCTAssertFalse(connection.isClosed)
        try await second.send(Data("{}".utf8))
        XCTAssertEqual(connection.sends, 2)
        second.close()
        XCTAssertTrue(connection.isClosed)
        XCTAssertNil(pool.take(key()).1)
    }

    func testObservedIdleCloseSelectsFreshConnectionBeforeTheOnlyNextSend() async throws {
        let pool = ResponsesConnectionPool()
        let closed = CompletingSocket()
        let first = pool.lease(closed, generation: pool.take(key()).0)
        let completed = ChatGPTSteerableResponse(connection: first, initialRequest: Data("{}".utf8))
        for try await _ in await completed.events() {}
        XCTAssertEqual(closed.sends, 1)

        closed.observePeerClose()
        let (generation, reused) = pool.take(key())
        XCTAssertNil(reused)
        XCTAssertTrue(closed.isClosed)
        let fresh = CompletingSocket()
        let next = pool.lease(reused ?? fresh, generation: generation)
        try await next.send(Data("{}".utf8))
        XCTAssertEqual(closed.sends, 1)
        XCTAssertEqual(fresh.sends, 1)
        next.close()
    }

    func testClosingOneLeaseDoesNotDisplaceAnotherIdleConnection() throws {
        let pool = ResponsesConnectionPool()
        let closing = CompletingSocket()
        let first = pool.lease(closing, generation: pool.take(key()).0)
        let survivor = CompletingSocket()
        let live = pool.lease(survivor, generation: pool.take(key()).0)
        live.completed()

        closing.observePeerClose()
        first.completed()
        XCTAssertTrue(closing.isClosed)
        XCTAssertFalse(survivor.isClosed)
        let reused = try XCTUnwrap(pool.take(key()).1)
        XCTAssertTrue(reused as AnyObject === survivor)
        reused.close()
    }

    func testChangingScopeAccountModelOrCredentialRejectsIdleTransport() {
        for changed in [key("other"), key("scope", "other"), key("scope", "account", "other"), key("scope", "account", "model", "other")] {
            let pool = ResponsesConnectionPool()
            let socket = CompletingSocket()
            let lease = pool.lease(socket, generation: pool.take(key()).0)
            lease.completed()
            XCTAssertNil(pool.take(changed).1)
            XCTAssertTrue(socket.isClosed)
        }
    }

    func testInvalidationFencesLateReturnAndConcurrentAcquisitionDoesNotShare() {
        let pool = ResponsesConnectionPool()
        let generation = pool.take(key()).0
        let socket = CompletingSocket()
        let lease = pool.lease(socket, generation: generation)
        XCTAssertNil(pool.take(key()).1)
        pool.invalidate()
        lease.completed()
        XCTAssertTrue(socket.isClosed)
        XCTAssertNil(pool.take(key()).1)
    }

    func testFailureAndCancellationNeverReturnSocket() {
        let pool = ResponsesConnectionPool()
        let socket = CompletingSocket()
        let lease = pool.lease(socket, generation: pool.take(key()).0)
        lease.close()
        lease.completed()
        XCTAssertTrue(socket.isClosed)
        XCTAssertNil(pool.take(key()).1)
    }

    func testMalformedResponseClosesLeaseWithoutReturningIt() async throws {
        let pool = ResponsesConnectionPool()
        let socket = CompletingSocket(malformed: true)
        let lease = pool.lease(socket, generation: pool.take(key()).0)
        let response = ChatGPTSteerableResponse(connection: lease, initialRequest: Data("{}".utf8))
        do {
            for try await _ in await response.events() {}
            XCTFail("Malformed response must fail")
        } catch {}
        for _ in 0 ..< 100 where !socket.isClosed {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTAssertTrue(socket.isClosed)
        XCTAssertNil(pool.take(key()).1)
    }

    func testIdleExpiryClosesTransport() async throws {
        let pool = ResponsesConnectionPool(idleNanoseconds: 1_000_000)
        let socket = CompletingSocket()
        pool.lease(socket, generation: pool.take(key()).0).completed()
        for _ in 0 ..< 100 where !socket.isClosed {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTAssertTrue(socket.isClosed)
        XCTAssertNil(pool.take(key()).1)
    }

    func testInvalidScopesAndPublicWebScopeAreRejected() {
        for scope in ["", "two words", "한글", String(repeating: "a", count: 129), 3] as [Any] {
            XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
                "model": "gpt-6", "transportScope": scope,
                "messages": [["role": "user", "content": "synthetic"]],
            ]))
        }
        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
            "model": "gpt-6", "publicWebQuery": "public synthetic query", "transportScope": "scope",
        ]))
    }

    func testScopeStaysNativeAndApprovedRequestRemainsComplete() throws {
        let request = try ChatGPTResponsesRequestDecoder.decode([
            "model": "gpt-6", "transportScope": "synthetic-scope",
            "messages": [["role": "user", "content": "current approved snapshot"]],
        ])
        XCTAssertEqual(request.transportScope, "synthetic-scope")
        let body = try XCTUnwrap(ChatGPTResponsesRequestBuilder.build(request, accessToken: "synthetic").httpBody)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(value["store"] as? Bool, false)
        XCTAssertNil(value["transportScope"])
        XCTAssertNil(value["previous_response_id"])
        XCTAssertEqual((value["input"] as? [[String: String]])?.first?["content"], "current approved snapshot")
    }
}

private final class CompletingSocket: ResponsesWebSocketConnection, @unchecked Sendable {
    private let lock = NSLock()
    private var closed = false
    private let upgrade = ResponsesWebSocketUpgradeGate()
    private var count = 0
    private var frames = [Data]()
    private let malformed: Bool
    init(malformed: Bool = false) {
        self.malformed = malformed
        upgrade.opened()
    }

    var observedClosed: Bool { upgrade.observedClosed }

    func observePeerClose() {
        upgrade.failed(httpStatus: nil)
    }

    var isClosed: Bool {
        lock.withLock { closed }
    }

    var sends: Int {
        lock.withLock { count }
    }

    func send(_: Data) async throws {
        try lock.withLock {
            guard !closed else { throw CancellationError() }
            count += 1
            if malformed {
                frames = [Data("invalid".utf8)]; return
            }
            frames = [
                #"{"type":"response.created","response":{"id":"synthetic","status":"in_progress"}}"#,
                #"{"type":"response.completed","response":{"id":"synthetic","status":"completed","output":[]}}"#,
            ].map { Data($0.utf8) }
        }
    }

    func receive() async throws -> Data {
        try lock.withLock {
            guard !closed, !frames.isEmpty else { throw CancellationError() }
            return frames.removeFirst()
        }
    }

    func close() {
        lock.withLock { closed = true }
    }
}
