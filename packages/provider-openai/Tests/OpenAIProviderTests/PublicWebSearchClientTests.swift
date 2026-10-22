import Foundation
@testable import OpenAIProvider
import XCTest

final class PublicWebSearchClientTests: XCTestCase {
    func testAccountTransportForwardsOnlyPublicQueryAndNormalizesCitedSearch() async throws {
        let text = "A public explanation."
        let completed = #"{"type":"response.completed","response":{"status":"completed","output":[{"type":"web_search_call","id":"ws_1","status":"completed","action":{"type":"search"}},{"type":"message","content":[{"type":"output_text","text":"A public explanation.","annotations":[{"type":"url_citation","start_index":0,"end_index":10,"url":"https://example.org/source","title":"Synthetic source"}]}]}]}}"#
        let source = try deltaEvent(text) + "event: response.completed\ndata: \(completed)\n\n"
        let transport = StubChatGPTResponsesHTTPTransport(chunks: sseChunks(source))
        let client = try responsesClient(transport)
        let result = try await client.generateResponse(
            ChatGPTResponsesRequest(model: "gpt-6-luna", messages: [], publicWebQuery: "Public concept"),
            for: accountAccess(),
        )
        XCTAssertEqual(result.text, text)
        XCTAssertEqual(result.webSearch?.callCount, 1)
        XCTAssertEqual(result.webSearch?.citations.first?.url, "https://example.org/source")
        XCTAssertTrue(result.continuationItems.isEmpty)
        let recorded = await transport.recordedRequest()
        let data = try XCTUnwrap(recorded?.httpBody)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(body["model"] as? String, "gpt-6-luna")
        XCTAssertEqual(body["input"] as? [[String: String]], [["role": "user", "content": "Public concept"]])
    }

    func testBoundsTotalPublicStreamEvenWhenIndividualEventsAndDisplayedTextAreSmall() async throws {
        let heartbeat = Data("event: response.created\ndata: {\"type\":\"response.created\"}\n\n".utf8)
        let chunks = Array(repeating: heartbeat, count: 20000)
        let client = try responsesClient(StubChatGPTResponsesHTTPTransport(chunks: chunks))
        do {
            _ = try await client.generateResponse(
                ChatGPTResponsesRequest(model: "gpt-6-luna", messages: [], publicWebQuery: "Public concept"),
                for: accountAccess(),
            )
            XCTFail("Expected a bounded-stream error")
        } catch {
            XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
        }
    }
}
