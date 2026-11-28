import Foundation

/// A single suspended data task. Construction is not submission.
final class SuspendedEncounterHTTP: @unchecked Sendable {
    private enum State { case suspended, running, retired }
    private let lock = NSLock()
    private var state = State.suspended
    private let session: URLSession
    private let task: URLSessionDataTask
    private let delegate: SuspendedEncounterHTTPDelegate

    init(request: URLRequest, protocolClasses: [AnyClass]?) throws {
        guard request.url == ChatGPTResponsesRequestBuilder.endpoint, request.url?.scheme == "https",
              request.httpMethod == "POST", request.httpBody != nil, request.httpBodyStream == nil
        else { throw ChatGPTResponsesError.invalidHTTPResponse }
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = false
        if let protocolClasses {
            config.protocolClasses = protocolClasses
        }
        let receiver = SuspendedEncounterHTTPDelegate()
        delegate = receiver
        session = URLSession(configuration: config, delegate: receiver, delegateQueue: nil)
        task = session.dataTask(with: request)
    }

    /// Caller must hold its current native owner on this synchronous turn.
    func resumeOnce() -> Bool {
        lock.withLock {
            guard state == .suspended, task.state == .suspended else { return false }
            state = .running
            task.resume()
            return true
        }
    }

    func response() async throws -> (URLResponse, AsyncThrowingStream<Data, Error>) {
        guard lock.withLock({ state == .running }) else { throw ChatGPTResponsesError.invalidRequest }
        var headers = delegate.headers.makeAsyncIterator()
        guard let response = try await headers.next() else { throw ChatGPTResponsesError.invalidHTTPResponse }
        return (response, delegate.body)
    }

    func cancel() {
        guard lock.withLock({ () -> Bool in
            guard state != .retired else { return false }
            state = .retired
            return true
        }) else { return }
        delegate.finish(CancellationError())
        session.invalidateAndCancel()
    }

    deinit { cancel() }
}

/// Use the same redirect, challenge and request-body refusal as the earlier
/// protected transport; nothing ever supplies a replacement request.
private final class SuspendedEncounterHTTPDelegate: ProtectedEncounterHTTPDelegate, URLSessionDataDelegate, @unchecked Sendable {
    let headers: AsyncThrowingStream<URLResponse, Error>
    let body: AsyncThrowingStream<Data, Error>
    private let headerOutput: AsyncThrowingStream<URLResponse, Error>.Continuation
    private let bodyOutput: AsyncThrowingStream<Data, Error>.Continuation

    override init() {
        (headers, headerOutput) = AsyncThrowingStream.makeStream(bufferingPolicy: .bufferingOldest(1))
        (body, bodyOutput) = AsyncThrowingStream.makeStream(bufferingPolicy: .bufferingOldest(64))
        super.init()
    }

    func urlSession(_: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void)
    {
        do {
            try DirectPhotoHTTPBoundary.validate(response)
            headerOutput.yield(response)
            headerOutput.finish()
            completionHandler(.allow)
        } catch {
            finish(error)
            completionHandler(.cancel)
            dataTask.cancel()
        }
    }

    func urlSession(_: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // Do not drop bytes or create an unbounded queued copy if decoder is stalled.
        var start = data.startIndex
        while start < data.endIndex {
            let end = data.index(start, offsetBy: min(4096, data.distance(from: start, to: data.endIndex)))
            switch bodyOutput.yield(data[start ..< end]) {
            case .enqueued:
                start = end
            default:
                finish(ChatGPTResponsesError.interrupted)
                dataTask.cancel()
                return
            }
        }
    }

    func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        finish(error)
    }

    func finish(_ error: Error?) {
        headerOutput.finish(throwing: error)
        bodyOutput.finish(throwing: error)
    }
}
