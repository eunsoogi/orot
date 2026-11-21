import Foundation

/// Fixed, query-independent publisher downloads. No browser, redirects, cookies,
/// credential prompts or storage. The React Native generic fetch handler is not used.
final class CuratedPublisherPageLoader: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private static let base = "https://medlineplus.gov/"
    private static let allowed = Set([
        "healthysleep.html",
        "highbloodpressure.html",
        "arrhythmia.html",
        "exerciseandphysicalfitness.html",
        "dehydration.html",
        "nutrition.html",
    ].map { base + $0 })
    private static let limit = 96 * 1024
    private enum Failure: Error {
        case unavailable
    }

    func load(exactURL: String) async throws -> String {
        guard Self.allowed.contains(exactURL), let url = URL(string: exactURL) else {
            throw Failure.unavailable
        }
        try Task.checkCancellation()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 8
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              http.url?.absoluteString == exactURL,
              http.mimeType?.lowercased() == "text/html"
        else {
            throw Failure.unavailable
        }

        // Read only the bounded metadata prefix. No body scripts or links are traversed.
        let closing = Array("</head>".utf8)
        var offset = 0
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < Self.limit else { throw Failure.unavailable }
            data.append(byte)
            let lower = byte >= 65 && byte <= 90 ? byte + 32 : byte
            if lower == closing[offset] {
                offset += 1
                if offset == closing.count {
                    guard let html = String(data: data, encoding: .utf8) else {
                        throw Failure.unavailable
                    }
                    return html
                }
            } else {
                offset = lower == closing[0] ? 1 : 0
            }
        }
        throw Failure.unavailable
    }

    func urlSession(_: URLSession, task _: URLSessionTask,
                    willPerformHTTPRedirection _: HTTPURLResponse,
                    newRequest _: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void)
    {
        // Reject before URLSession can contact the redirect destination.
        completionHandler(nil)
    }
}
