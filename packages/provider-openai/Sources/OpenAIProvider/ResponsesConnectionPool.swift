import Foundation

/// One idle transport, never remote conversation state. All calls still send full authorized input.
final class ResponsesConnectionPool: @unchecked Sendable {
    struct Key: Equatable, Sendable {
        let scope: String
        let account: String
        let model: String
        let credential: String
    }

    private let lock = NSLock()
    private var key: Key?
    private var generation = 0
    private var idle: (UUID, any ResponsesWebSocketConnection)?
    private var expiry: Task<Void, Never>?
    private let idleNanoseconds: UInt64

    init(idleNanoseconds: UInt64 = 30_000_000_000) {
        self.idleNanoseconds = idleNanoseconds
    }

    func take(_ requested: Key) -> (Int, (any ResponsesWebSocketConnection)?) {
        lock.withLock {
            if key != requested {
                generation += 1
                idle?.1.close()
                idle = nil
                key = requested
            }
            expiry?.cancel()
            expiry = nil
            let connection = idle?.1
            idle = nil
            return (generation, connection)
        }
    }

    func lease(_ connection: any ResponsesWebSocketConnection, generation: Int) -> any ResponsesWebSocketConnection {
        ResponsesConnectionLease(connection: connection) { [weak self] in
            guard let self else { connection.close(); return }
            release(connection, generation: generation)
        }
    }

    private func release(_ connection: any ResponsesWebSocketConnection, generation expected: Int) {
        lock.withLock {
            guard generation == expected else { connection.close(); return }
            idle?.1.close()
            expiry?.cancel()
            let ticket = UUID()
            idle = (ticket, connection)
            expiry = Task { [weak self, idleNanoseconds] in
                do { try await Task.sleep(nanoseconds: idleNanoseconds) } catch { return }
                self?.expire(ticket)
            }
        }
    }

    private func expire(_ ticket: UUID) {
        lock.withLock {
            guard idle?.0 == ticket else { return }
            idle?.1.close()
            idle = nil
            key = nil
            generation += 1
            expiry = nil
        }
    }

    func invalidate() {
        lock.withLock {
            generation += 1
            idle?.1.close()
            idle = nil
            key = nil
            expiry?.cancel()
            expiry = nil
        }
    }

    deinit { idle?.1.close(); expiry?.cancel() }
}

/// A retired request's deferred close must not close a connection lent to its successor.
private final class ResponsesConnectionLease: ResponsesWebSocketConnection, @unchecked Sendable {
    private let lock = NSLock()
    private let connection: any ResponsesWebSocketConnection
    private let release: @Sendable () -> Void
    private var retired = false

    init(connection: any ResponsesWebSocketConnection, release: @escaping @Sendable () -> Void) {
        self.connection = connection
        self.release = release
    }

    func send(_ data: Data) async throws {
        guard lock.withLock({ !retired }) else { throw ChatGPTResponsesError.interrupted }
        try await connection.send(data)
    }

    func receive() async throws -> Data {
        guard lock.withLock({ !retired }) else { throw ChatGPTResponsesError.interrupted }
        return try await connection.receive()
    }

    func completed() {
        lock.withLock {
            guard !retired else { return }
            retired = true
            release()
        }
    }

    func close() {
        lock.withLock {
            guard !retired else { return }
            retired = true
            connection.close()
        }
    }
}
