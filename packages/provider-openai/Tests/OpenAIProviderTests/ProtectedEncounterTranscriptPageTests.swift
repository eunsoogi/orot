import Foundation
@testable import OpenAIProvider
import XCTest

final class ProtectedEncounterTranscriptPageTests: XCTestCase {
    private let model = "synthetic-model"
    private let account = "synthetic-account"
    private let subject = "synthetic-subject"

    func testTypedPageRejectsOrdinaryHistoryAndOtherDestinations() throws {
        let safe = ChatGPTResponsesRequest(model: model, messages: [.system("Synthetic instructions"), .user("Synthetic page")])
        let page = try ProtectedEncounterTranscriptPage(request: safe, accountID: account, accountSubject: subject, selectedModel: model)
        XCTAssertFalse(page.claim(accountID: "other", accountSubject: subject))
        XCTAssertFalse(page.claim(accountID: account, accountSubject: "other"))
        XCTAssertTrue(page.claim(accountID: account, accountSubject: subject))
        XCTAssertFalse(page.claim(accountID: account, accountSubject: subject))
        XCTAssertThrowsError(try ProtectedEncounterTranscriptPage(request: safe, accountID: account, accountSubject: subject, selectedModel: "other"))

        for message in [ChatGPTResponsesMessage.assistant("history"), .userPhoto(text: "photo", normalizedJPEG: Data()),
                        .functionCallOutput(callID: "synthetic", output: "result"), .continuationItem(json: "{}")]
        {
            let bad = ChatGPTResponsesRequest(model: model, messages: safe.messages + [message])
            XCTAssertThrowsError(try ProtectedEncounterTranscriptPage(request: bad, accountID: account, accountSubject: subject, selectedModel: model))
        }
        let web = ChatGPTResponsesRequest(model: model, messages: safe.messages, publicWebQuery: "synthetic public query")
        XCTAssertThrowsError(try ProtectedEncounterTranscriptPage(request: web, accountID: account, accountSubject: subject, selectedModel: model))
    }

    func testDedicatedWirePreservesTheFourExactApprovedRoles() throws {
        let wire = ProtectedEncounterTranscriptPage.Wire(
            instruction: "Synthetic instructions",
            transcript: "Synthetic page\n",
            citations: "Synthetic citations",
            schema: "Synthetic schema",
        )
        let page = try ProtectedEncounterTranscriptPage(wire: wire, accountID: account,
                                                        accountSubject: subject, selectedModel: model)
        XCTAssertEqual(page.request.model, model)
        XCTAssertEqual(page.request.messages, [
            .system(wire.instruction), .user(wire.transcript), .user(wire.citations), .user(wire.schema),
        ])
        XCTAssertNil(page.request.transportScope)
        XCTAssertTrue(page.request.tools.isEmpty)
        XCTAssertTrue(page.claim(accountID: account, accountSubject: subject))
        XCTAssertFalse(page.claim(accountID: account, accountSubject: subject))
    }

    func testRedirectCallbackNeverSuppliesAReplayRequestAndCannotReplaceBodyStream() throws {
        let transport = ProtectedEncounterHTTPDelegate()
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let endpoint = ChatGPTResponsesRequestBuilder.endpoint
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = Data("Synthetic page".utf8)
        let other = try XCTUnwrap(URL(string: "https://different.invalid/v1/responses"))
        for status in [301, 302, 303, 307, 308] {
            for url in [endpoint, other] {
                let task = session.dataTask(with: request) // never resumed
                let response = try XCTUnwrap(HTTPURLResponse(url: endpoint, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Location": url.absoluteString]))
                var destination = request
                destination.url = url
                transport.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: destination) { replay in
                    XCTAssertNil(replay)
                }
                XCTAssertThrowsError(try DirectPhotoHTTPBoundary.validate(response))
            }
        }
        let task = session.dataTask(with: request) // never resumed
        transport.urlSession(session, task: task, needNewBodyStream: { XCTAssertNil($0) })
        task.cancel()
    }

    func testProtectedTransportRejectsDifferentEndpointBeforeCreatingTask() throws {
        let other = try XCTUnwrap(URL(string: "https://different.invalid/v1/responses"))
        var request = URLRequest(url: other)
        request.httpMethod = "POST"
        request.httpBody = Data("Synthetic page".utf8)
        let transport = URLSessionChatGPTResponsesHTTPTransport(session: .shared)
        do {
            _ = try transport.prepareSuspendedEncounterPage(for: request)
            XCTFail("Different endpoint accepted")
        } catch let error as ChatGPTResponsesError {
            XCTAssertEqual(error, .invalidHTTPResponse)
        }
    }
}
