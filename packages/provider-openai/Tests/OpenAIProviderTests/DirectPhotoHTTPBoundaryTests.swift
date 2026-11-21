import Foundation
@testable import OpenAIProvider
import XCTest

/// A private URLProtocol handles all URLs in this session, including unintended
/// redirects. No packets, provider credentials, or real images are used.
final class DirectPhotoHTTPBoundaryTests: XCTestCase {
    private let endpoint = ChatGPTResponsesRequestBuilder.endpoint

    func testInitialPostIsAdmittedButSameAndDifferentOriginRedirectsAreNotResent() async throws {
        for (status, destination) in [
            (307, "https://api.openai.com/not-the-disclosed-path"),
            (308, "https://photo-redirect.example.invalid/v1/responses"),
        ] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectPhotoRedirectURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let transport = URLSessionChatGPTResponsesHTTPTransport(session: session)
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.httpBody = Data([1, 2, 3])
            request.setValue(String(status), forHTTPHeaderField: "X-Test-Redirect-Status")
            request.setValue(destination, forHTTPHeaderField: "X-Test-Redirect-Destination")
            let trace = DirectPhotoRedirectURLProtocol.trace
            trace.clear()
            do {
                _ = try await transport.streamDirectPhoto(for: request)
                XCTFail("Redirect response must not reach the body decoder")
            } catch {
                XCTAssertEqual(error as? ChatGPTResponsesError, .invalidHTTPResponse)
            }
            XCTAssertEqual(trace.snapshot(), [endpoint])
        }
    }

    func testRejectsUntrustedFinalResponseBeforeBodyParsing() throws {
        for url in [
            "http://api.openai.com/v1/responses",
            "https://api.openai.com:8443/v1/responses",
            "https://api.openai.com/unreviewed",
            "https://photo-redirect.example.invalid/v1/responses",
        ] {
            let response = try XCTUnwrap(HTTPURLResponse(
                url: XCTUnwrap(URL(string: url)),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "text/event-stream"],
            ))
            XCTAssertThrowsError(try DirectPhotoHTTPBoundary.validate(response))
        }
        let exact = try XCTUnwrap(HTTPURLResponse(
            url: endpoint,
            statusCode: 200,
            httpVersion: nil,
            headerFields: nil,
        ))
        XCTAssertNoThrow(try DirectPhotoHTTPBoundary.validate(exact))
    }
}

private final class DirectPhotoRedirectTrace: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [URL] = []
    func clear() { lock.withLock { urls.removeAll() } }
    func record(_ url: URL) { lock.withLock { urls.append(url) } }
    func snapshot() -> [URL] { lock.withLock { urls } }
}

private final class DirectPhotoRedirectURLProtocol: URLProtocol, @unchecked Sendable {
    static let trace = DirectPhotoRedirectTrace()
    private static let endpoint = ChatGPTResponsesRequestBuilder.endpoint

    override class func canInit(with _: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        Self.trace.record(url)
        guard url == Self.endpoint,
              request.httpMethod == "POST",
              let statusText = request.value(forHTTPHeaderField: "X-Test-Redirect-Status"),
              let status = Int(statusText),
              let destination = request.value(forHTTPHeaderField: "X-Test-Redirect-Destination"),
              let target = URL(string: destination),
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Location": destination])
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        var proposed = request
        proposed.url = target
        client?.urlProtocol(self, wasRedirectedTo: proposed, redirectResponse: response)
    }

    override func stopLoading() {}
}
