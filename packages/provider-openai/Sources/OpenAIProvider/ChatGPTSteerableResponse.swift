import Foundation

/// Serializes socket reads and submissions while cancellation always closes the connection.
/// Pending server input never survives reconnect and is never automatically submitted again.
public actor ChatGPTSteerableResponse {
    /// Protocol eligibility only; runtime readiness is established by response.created, not this flag.
    public nonisolated static func supportsModel(_ model: String) -> Bool {
        model == "gpt-6" || model.hasPrefix("gpt-6-") || model.hasPrefix("gpt-6.")
    }

    private let connection: any ResponsesWebSocketConnection
    private let initialRequest: Data
    private var state = ResponsesSteeringState()
    private var started = false
    private var closed = false

    init(connection: any ResponsesWebSocketConnection, initialRequest: Data) {
        self.connection = connection
        self.initialRequest = initialRequest
    }

    public func steer(submissionID: String, text: String) async throws {
        guard started, !closed else { throw ChatGPTResponsesError.interrupted }
        let payload = try state.prepareSteer(submissionID: submissionID, text: text)
        do { try await connection.send(payload) }
        catch {
            // The write may have reached the server. Close and report unknown rather than replaying it.
            closed = true
            connection.close()
            throw ChatGPTResponsesError.transportUnavailable
        }
    }

    public func events() -> AsyncThrowingStream<ChatGPTSteerableEvent, Error> {
        guard !started else { return AsyncThrowingStream { $0.finish(throwing: ChatGPTResponsesError.invalidRequest) } }
        started = true
        return AsyncThrowingStream { continuation in
            let task = Task {
                let deadline = Task {
                    try await Task.sleep(nanoseconds: 180_000_000_000)
                    self.close()
                }
                defer { deadline.cancel(); self.close() }
                do {
                    try await connection.send(initialRequest)
                    while !closed {
                        let data = try await connection.receive()
                        try Task.checkCancellation()
                        guard !closed else { throw ChatGPTResponsesError.interrupted }
                        for event in try state.consume(data) {
                            continuation.yield(event)
                        }
                        if state.finished {
                            continuation.finish(); return
                        }
                    }
                    throw ChatGPTResponsesError.interrupted
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { @Sendable _ in
                task.cancel()
                Task { await self.close() }
            }
        }
    }

    /// Synchronous cancellation is used by sign-out before another bridge submission can run.
    public nonisolated func cancel() {
        connection.close()
    }

    public func close() {
        closed = true
        connection.close()
    }
}
