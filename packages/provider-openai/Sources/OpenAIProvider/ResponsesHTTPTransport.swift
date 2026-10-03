import Foundation

protocol ChatGPTResponsesHTTPTransport: Sendable {
    func stream(for request: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>)
}

struct URLSessionChatGPTResponsesHTTPTransport: ChatGPTResponsesHTTPTransport {
    let session: URLSession

    func stream(for request: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>) {
        let (bytes, response) = try await session.bytes(for: request)
        let chunks = AsyncThrowingStream<Data, Error> { continuation in
            let task = Task {
                var buffer = Data()
                do {
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        buffer.append(byte)
                        if byte == 0x0A || byte == 0x0D || buffer.count == 4_096 {
                            continuation.yield(buffer)
                            buffer.removeAll(keepingCapacity: true)
                        }
                    }
                    if !buffer.isEmpty { continuation.yield(buffer) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
        return (response, chunks)
    }
}
