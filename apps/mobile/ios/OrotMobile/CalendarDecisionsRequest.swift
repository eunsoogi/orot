import Foundation

/// Calendar text and credentials may leave the device only for this approved origin and path.
/// Redirects are never followed, even to the same origin: consent does not authorize a replay.
final class CalendarDecisionsRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let endpoint = URL(string: "https://api.openai.com/v1/decisions")!
    private let completion: @Sendable (Result<String, Error>) -> Void
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var received = Data()
    private var finished = false
    private let lock = NSLock()
    private var cancelled = false

    enum Failure: Error { case invalidRequest, transport, rejectedResponse, oversized, cancelled }

    init(completion: @escaping @Sendable (Result<String, Error>) -> Void) {
        self.completion = completion
    }

    func start(body: String, apiKey: String) {
        guard let data = body.data(using: .utf8), data.count <= 65536,
              !apiKey.isEmpty, apiKey.utf8.count <= 8192,
              !apiKey.contains("\r"), !apiKey.contains("\n"),
              (try? JSONSerialization.jsonObject(with: data)) is [String: Any]
        else { finish(.failure(Failure.invalidRequest)); return }
        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 45
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.dataTask(with: request)
        lock.lock()
        self.session = session
        self.task = task
        let shouldCancel = cancelled
        // Registration and resume share the cancel lock, so cancellation cannot miss an unregistered task.
        if !shouldCancel {
            task.resume()
        }
        lock.unlock()
        if shouldCancel {
            task.cancel(); finish(.failure(Failure.cancelled))
        }
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let task = task
        lock.unlock()
        task?.cancel()
    }

    func urlSession(_: URLSession, task _: URLSessionTask,
                    willPerformHTTPRedirection _: HTTPURLResponse, newRequest _: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void)
    {
        completionHandler(nil)
    }

    func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void)
    {
        guard let http = response as? HTTPURLResponse, http.url == Self.endpoint,
              (200 ... 299).contains(http.statusCode), response.expectedContentLength <= 262_144
        else {
            completionHandler(.cancel)
            finish(.failure(Failure.rejectedResponse))
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive data: Data) {
        guard received.count + data.count <= 262_144 else {
            cancel()
            finish(.failure(Failure.oversized))
            return
        }
        received.append(data)
    }

    func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        guard error == nil, let value = String(data: received, encoding: .utf8) else {
            finish(.failure(Failure.transport))
            return
        }
        finish(.success(value))
    }

    private func finish(_ result: Result<String, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let session = session
        self.session = nil
        task = nil
        lock.unlock()
        session?.invalidateAndCancel()
        completion(result)
    }
}
