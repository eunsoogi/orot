import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTMissingContentTypeTests: XCTestCase {
    private let request = ChatGPTResponsesRequest(model: "synthetic-luna", messages: [.user("Synthetic question")])

    func testMissingHeaderStillRequiresValidatedSSECompletion() async throws {
        // Mirrors the device's HTTP 200 without MIME metadata; all response content is synthetic.
        let events = try deltaEvent("Synthetic answer") + completedEvent("Synthetic answer")
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(
            chunks: sseChunks(events, chunkSize: 3), contentType: nil,
        ))
        let result = try await client.generateResponse(request, for: accountAccess())
        XCTAssertEqual(result.text, "Synthetic answer")
    }

    func testExplicitWrongContentTypeRemainsRejectedEvenForSSEBody() async throws {
        let events = try deltaEvent("Synthetic answer") + completedEvent("Synthetic answer")
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(
            chunks: sseChunks(events), contentType: "text/html",
        ))
        do {
            _ = try await client.generateResponse(request, for: accountAccess())
            XCTFail("An explicit incompatible MIME type must be rejected.")
        } catch { XCTAssertEqual(error as? ChatGPTResponsesError, .invalidContentType) }
    }

    func testMissingHeaderExceptionDoesNotApplyToAnotherHost() async throws {
        let events = try deltaEvent("Synthetic answer") + completedEvent("Synthetic answer")
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(
            chunks: sseChunks(events), contentType: nil, responseURL: URL(string: "https://example.invalid/responses"),
        ))
        do {
            _ = try await client.generateResponse(request, for: accountAccess())
            XCTFail("Missing MIME metadata is allowed only on the expected API host.")
        } catch { XCTAssertEqual(error as? ChatGPTResponsesError, .invalidContentType) }
    }

    func testMissingHeaderDoesNotConvertJSONOrHTMLIntoAnAnswer() async throws {
        for body in [#"{"text":"unvalidated synthetic answer"}"#, "<html>synthetic error page</html>"] {
            let client = try responsesClient(StubChatGPTResponsesHTTPTransport(chunks: [Data(body.utf8)], contentType: nil))
            do {
                _ = try await client.generateResponse(request, for: accountAccess())
                XCTFail("Only normalized SSE completion may produce a result.")
            } catch { XCTAssertNotNil(error as? ChatGPTResponsesError) }
        }
    }
}
