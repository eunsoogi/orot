import Foundation
@_spi(SelectedEncounterNative) @testable import OpenAIProvider
import XCTest

final class SuspendedEncounterResponseTests: XCTestCase {
    @MainActor
    func testSelectedPlanFactoryNeverStartsDeclinedPageAndEmitsOneCompletedTerminal() async throws {
        let transport = URLSessionChatGPTResponsesHTTPTransport(
            session: .shared, encounterProtocolClasses: [EncounterInertSSEProtocol.self],
        )
        let client = try responsesClient(transport)
        let account = accountAccess()
        func page() -> ChatGPTSelectedEncounterPage {
            .init(accountID: account.issuedClientID, subject: account.subject, model: "selected-model",
                  instruction: "Generated instruction", transcript: "Generated final transcript row",
                  citations: "Generated citations", schema: "Generated schema")
        }
        let afterRefresh = SecondCheckDeclines()
        do {
            _ = try await client.prepareSelectedEncounterPage(page(), admitted: { await afterRefresh.admit() })
            XCTFail("Revocation at the refreshed boundary admitted a task.")
        } catch let error as ChatGPTResponsesError {
            XCTAssertEqual(error, .invalidRequest)
        }
        let held = try await client.prepareSelectedEncounterPage(page(), admitted: { true })
        XCTAssertTrue(EncounterInertSSEProtocol.requests.isEmpty)
        XCTAssertFalse(held.admitAndResume(admitted: { false }))
        XCTAssertFalse(held.admitAndResume(admitted: { true }))
        XCTAssertTrue(EncounterInertSSEProtocol.requests.isEmpty)

        let fresh = try await client.prepareSelectedEncounterPage(page(), admitted: { true })
        XCTAssertTrue(EncounterInertSSEProtocol.requests.isEmpty)
        XCTAssertTrue(fresh.admitAndResume(admitted: { true }))
        XCTAssertFalse(fresh.admitAndResume(admitted: { true }))
        let terminal = try await fresh.terminal()
        XCTAssertEqual(terminal.text, "Generated result")
        XCTAssertTrue(terminal.toolCalls.isEmpty)
        XCTAssertTrue(terminal.continuationItems.isEmpty)
        do {
            _ = try await fresh.terminal()
            XCTFail("The prepared task returned a second terminal.")
        } catch let error as ChatGPTResponsesError {
            XCTAssertEqual(error, .invalidRequest)
        }
        let requests = EncounterInertSSEProtocol.requests
        XCTAssertEqual(requests.count, 1)
        let delivered = try XCTUnwrap(requests.first)
        XCTAssertEqual(delivered.url, ChatGPTResponsesRequestBuilder.endpoint)
        XCTAssertEqual(delivered.httpMethod, "POST")
        XCTAssertEqual(delivered.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access-token")
        XCTAssertNil(delivered.value(forHTTPHeaderField: "Cookie"))
    }
}

private actor SecondCheckDeclines {
    private var seen = false

    func admit() -> Bool {
        defer { seen = true }
        return !seen
    }
}

private final class EncounterInertSSEProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private nonisolated(unsafe) static var started = [URLRequest]()
    static var requests: [URLRequest] {
        lock.withLock { started }
    }

    override class func canInit(with _: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.lock.withLock { Self.started.append(request) }
        guard let url = request.url, url == ChatGPTResponsesRequestBuilder.endpoint,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "text/event-stream"]),
              let delta = try? deltaEvent("Generated result")
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in sseChunks(delta + completedEvent("Generated result")) {
            client?.urlProtocol(self, didLoad: chunk)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
