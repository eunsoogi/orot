import Foundation
import Network

/// A one-shot HTTP listener shared by the native app and OAuth validation spike.
/// The listener binds only to IPv4 loopback and stops after its first callback.
public final class LoopbackCallbackServer: @unchecked Sendable {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.orot.oauth-spike.loopback")
    private let returnsToApp: Bool
    private var listener: NWListener?
    private var readyContinuation: CheckedContinuation<URL, Error>?
    private var callbackContinuation: CheckedContinuation<URL, Error>?
    private var callbackResult: Result<URL, Error>?
    private var port: NWEndpoint.Port?

    /// Creates a one-shot IPv4 loopback listener for the OAuth redirect.
    /// Successful callbacks redirect only to Orot's fixed, secret-free authentication-session return URL.
    public init(returnsToApp: Bool = false) {
        self.returnsToApp = returnsToApp
    }

    public func start() async throws -> URL {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let listener = try NWListener(using: parameters, on: .any)

        return try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            self.listener = listener
            readyContinuation = continuation
            lock.unlock()

            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    guard let port = listener.port,
                          let redirect = URL(
                              string: "http://127.0.0.1:\(port.rawValue)\(ChatGPTOAuthConstants.callbackPath)",
                          )
                    else {
                        finishReady(.failure(LoopbackError.listenerUnavailable))
                        return
                    }
                    lock.lock()
                    self.port = port
                    lock.unlock()
                    finishReady(.success(redirect))
                case .failed:
                    finishReady(.failure(LoopbackError.listenerUnavailable))
                case .cancelled:
                    finishReady(.failure(CancellationError()))
                case .setup, .waiting:
                    break
                @unknown default:
                    finishReady(.failure(LoopbackError.listenerUnavailable))
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.receiveRequest(on: connection, buffered: Data())
            }
            listener.start(queue: queue)
        }
    }

    public func waitForCallback() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let callbackResult {
                lock.unlock()
                continuation.resume(with: callbackResult)
            } else {
                callbackContinuation = continuation
                lock.unlock()
            }
        }
    }

    public func stop() {
        lock.lock()
        let listener = listener
        self.listener = nil
        let ready = readyContinuation
        readyContinuation = nil
        let callback = callbackContinuation
        callbackContinuation = nil
        if case .none = callbackResult {
            callbackResult = .failure(CancellationError())
        }
        lock.unlock()

        listener?.cancel()
        ready?.resume(throwing: CancellationError())
        callback?.resume(throwing: CancellationError())
    }

    private func finishReady(_ result: Result<URL, Error>) {
        lock.lock()
        let continuation = readyContinuation
        readyContinuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    private func finishCallback(_ result: Result<URL, Error>) {
        lock.lock()
        guard case .none = callbackResult else {
            lock.unlock()
            return
        }
        callbackResult = result
        let continuation = callbackContinuation
        callbackContinuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    private func receiveRequest(on connection: NWConnection, buffered: Data) {
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self, let connection else { return }
            if case .ready = state {
                receiveBytes(on: connection, buffered: buffered)
            }
        }
        connection.start(queue: queue)
    }

    private func receiveBytes(on connection: NWConnection, buffered: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, complete, error in
            guard let self else { return }
            var request = buffered
            if let data {
                request.append(data)
            }

            let headerEnd = Data("\r\n\r\n".utf8)
            if request.range(of: headerEnd) != nil {
                handleRequest(request, on: connection)
            } else if request.count >= 8192 || complete || error != nil {
                respond(400, body: "콜백 요청이 올바르지 않습니다. Orot 앱으로 돌아가세요.", on: connection)
            } else {
                receiveBytes(on: connection, buffered: request)
            }
        }
    }

    private func handleRequest(_ data: Data, on connection: NWConnection) {
        guard let port, let text = String(data: data, encoding: .utf8),
              let firstLine = text.components(separatedBy: "\r\n").first
        else {
            respond(400, body: "콜백 요청이 올바르지 않습니다. Orot 앱으로 돌아가세요.", on: connection)
            return
        }
        let fields = firstLine.split(separator: " ", omittingEmptySubsequences: true)
        guard fields.count == 3, fields[0] == "GET",
              let callbackURL = URL(
                  string: "http://127.0.0.1:\(port.rawValue)\(fields[1])",
              ),
              callbackURL.path == ChatGPTOAuthConstants.callbackPath
        else {
            respond(404, body: "로그인 응답을 찾지 못했습니다. Orot 앱으로 돌아가세요.", on: connection)
            return
        }
        let status = returnsToApp ? 302 : 200
        respond(
            status,
            body: "로그인 응답을 받았습니다. Orot 앱으로 돌아가세요.",
            on: connection,
            redirectTo: returnsToApp ? ChatGPTOAuthConstants.appReturnURL : nil,
        ) { [weak self] in
            self?.finishCallback(.success(callbackURL))
            self?.stop()
        }
    }

    private func respond(
        _ status: Int,
        body: String,
        on connection: NWConnection,
        redirectTo: URL? = nil,
        completion: @escaping @Sendable () -> Void = {},
    ) {
        let reason = switch status {
        case 200: "OK"
        case 302: "Found"
        case 404: "Not Found"
        default: "Bad Request"
        }
        let bodyData = Data(body.utf8)
        var headers = [
            "Content-Type: text/plain; charset=utf-8",
            "Content-Length: \(bodyData.count)",
            "Connection: close",
        ]
        if let redirectTo {
            headers.append(contentsOf: [
                "Location: \(redirectTo.absoluteString)",
                "Cache-Control: no-store",
                "Referrer-Policy: no-referrer",
            ])
        }
        var response = Data(
            "HTTP/1.1 \(status) \(reason)\r\n\(headers.joined(separator: "\r\n"))\r\n\r\n".utf8,
        )
        response.append(bodyData)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
            completion()
        })
    }
}

private enum LoopbackError: LocalizedError {
    case listenerUnavailable

    var errorDescription: String? {
        "127.0.0.1 콜백 리스너를 시작하지 못했습니다."
    }
}
