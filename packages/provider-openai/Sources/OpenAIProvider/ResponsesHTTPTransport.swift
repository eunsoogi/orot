import Foundation

protocol ChatGPTResponsesHTTPTransport: Sendable {
    func stream(for request: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>)
    func streamDirectPhoto(for request: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>)
}

extension ChatGPTResponsesHTTPTransport {
    // Other transports must explicitly implement the protected photo route;
    // never fall through to their ordinary request and redirect behavior.
    func streamDirectPhoto(for _: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>) {
        throw ChatGPTResponsesError.transportUnavailable
    }
}

struct URLSessionChatGPTResponsesHTTPTransport: ChatGPTResponsesHTTPTransport {
    let session: URLSession

    func stream(for request: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>) {
        let (bytes, response) = try await session.bytes(for: request)
        return (response, Self.chunks(bytes))
    }

    func streamDirectPhoto(for request: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>) {
        guard request.url == ChatGPTResponsesRequestBuilder.endpoint, request.httpMethod == "POST" else {
            throw ChatGPTResponsesError.invalidHTTPResponse
        }
        // Install the delegate before starting a task. Both same-origin and
        // cross-origin redirects may replay a 307/308 POST.
        let redirect = DirectPhotoNoRedirectDelegate()
        let configuration = session.configuration
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let photoSession = URLSession(
            configuration: configuration,
            delegate: redirect,
            delegateQueue: nil,
        )
        do {
            let (bytes, response) = try await photoSession.bytes(for: request)
            guard !redirect.refused else { throw ChatGPTResponsesError.invalidHTTPResponse }
            try DirectPhotoHTTPBoundary.validate(response)
            return (response, Self.chunks(bytes, ownedSession: photoSession))
        } catch {
            photoSession.invalidateAndCancel()
            if redirect.refused { throw ChatGPTResponsesError.invalidHTTPResponse }
            throw error
        }
    }

    private static func chunks(
        _ bytes: URLSession.AsyncBytes,
        ownedSession: URLSession? = nil,
    ) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream<Data, Error> { continuation in
            let task = Task {
                var buffer = Data()
                do {
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        buffer.append(byte)
                        if byte == 0x0A || byte == 0x0D || buffer.count == 4096 {
                            continuation.yield(buffer)
                            buffer.removeAll(keepingCapacity: true)
                        }
                    }
                    if !buffer.isEmpty {
                        continuation.yield(buffer)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in
                task.cancel()
                ownedSession?.invalidateAndCancel()
            }
        }
    }
}

/// Use only the exact disclosed endpoint; do not examine a redirect body or Location.
enum DirectPhotoHTTPBoundary {
    static func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse,
              http.url == ChatGPTResponsesRequestBuilder.endpoint,
              !(300 ... 399).contains(http.statusCode)
        else {
            throw ChatGPTResponsesError.invalidHTTPResponse
        }
    }
}

final class DirectPhotoNoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var redirectRefused = false
    var refused: Bool { lock.withLock { redirectRefused } }

    func urlSession(_: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection _: HTTPURLResponse, newRequest _: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void)
    {
        lock.withLock { redirectRefused = true }
        completionHandler(nil)
        task.cancel()
    }
}
