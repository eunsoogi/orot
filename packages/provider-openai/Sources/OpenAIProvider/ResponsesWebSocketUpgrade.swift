import Foundation

/// A server explicitly refused the HTTP upgrade before any response frame was sent.
/// This is not a general transport error and must never be inferred from a failed send.
public enum ResponsesWebSocketUpgradeError: Error {
    case rejectedBeforeRequest
}

/// One-shot handshake gate. Only didOpen releases the caller to construct a response stream.
final class ResponsesWebSocketUpgradeGate: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Void, Error>?
    private var waiter: CheckedContinuation<Void, Error>?

    func wait() async throws {
        try await withCheckedThrowingContinuation { continuation in
            let completed = lock.withLock { () -> Result<Void, Error>? in
                if let result {
                    return result
                }
                guard waiter == nil else { return .failure(ResponsesRequestValidationDiagnostics.failure(.duplicateUpgradeWait)) }
                waiter = continuation
                return nil
            }
            if let completed {
                continuation.resume(with: completed)
            }
        }
    }

    func opened() {
        finish(.success(()))
    }

    func failed(httpStatus: Int?) {
        // Unsupported upgrade is definitive; authentication, throttling, server
        // outages, redirects and ambiguous disconnects must remain failures.
        let rejected = httpStatus.map { [404, 405, 426, 501].contains($0) } ?? false
        finish(.failure(rejected ? ResponsesWebSocketUpgradeError.rejectedBeforeRequest : ChatGPTResponsesError.transportUnavailable))
    }

    func cancelled() {
        finish(.failure(CancellationError()))
    }

    private func finish(_ value: Result<Void, Error>) {
        let pending = lock.withLock { () -> CheckedContinuation<Void, Error>? in
            guard result == nil else { return nil }
            result = value
            defer { waiter = nil }
            return waiter
        }
        pending?.resume(with: value)
    }
}

/// URLSession metadata proves the pre-frame upgrade outcome. No URLs, tokens or response bodies are logged.
final class ResponsesWebSocketUpgradeDelegate: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    let gate = ResponsesWebSocketUpgradeGate()

    func urlSession(_: URLSession, webSocketTask _: URLSessionWebSocketTask, didOpenWithProtocol _: String?) {
        gate.opened()
    }

    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError _: Error?) {
        gate.failed(httpStatus: (task.response as? HTTPURLResponse)?.statusCode)
    }

    func urlSession(_: URLSession, webSocketTask _: URLSessionWebSocketTask, didCloseWith _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {
        gate.failed(httpStatus: nil)
    }

    func urlSession(_: URLSession, task _: URLSessionTask, willPerformHTTPRedirection _: HTTPURLResponse, newRequest _: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
