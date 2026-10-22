import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesPublicWebSearchTests: XCTestCase {
    func testPublicRequestContainsOnlyItsQueryAndSelectedModel() throws {
        let input = try ChatGPTResponsesRequestDecoder.decode([
            "model": "gpt-6-luna", "publicWebQuery": "혈압과 운동의 관계",
        ])
        let request = try ChatGPTResponsesRequestBuilder.build(input, accessToken: "synthetic-token")
        let data = try XCTUnwrap(request.httpBody)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(body["model"] as? String, "gpt-6-luna")
        XCTAssertEqual(body["store"] as? Bool, false)
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertEqual(body["tool_choice"] as? String, "required")
        XCTAssertNil(body["max_tool_calls"])
        XCTAssertNil(body["max_output_tokens"])
        XCTAssertNil(body["previous_response_id"])
        let messages = try XCTUnwrap(body["input"] as? [[String: String]])
        XCTAssertEqual(messages, [["role": "user", "content": "혈압과 운동의 관계"]])
        let tools = try XCTUnwrap(body["tools"] as? [[String: String]])
        XCTAssertEqual(tools, [["type": "web_search", "search_context_size": "low"]])
    }

    func testPublicBoundaryRejectsHistoryToolsAndInvalidQueries() {
        for query in ["", " query", "query\nidentity", String(repeating: "a", count: 241)] {
            XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
                "model": "gpt-6-luna", "publicWebQuery": query,
            ]))
        }
        for key in ["messages", "tools", "toolChoice", "continuationItems"] {
            XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
                "model": "gpt-6-luna", "publicWebQuery": "public concept", key: [],
            ]))
        }
        XCTAssertThrowsError(try ChatGPTResponsesRequestBuilder.build(
            ChatGPTResponsesRequest(model: "gpt-6-luna", messages: [.user("private history")], publicWebQuery: "public concept"),
            accessToken: "synthetic-token",
        ))
    }

    func testOptedInSearchReturnsCitationsWithoutReusableContinuationHistory() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        try addSearch(&normalizer, id: "ws_1")
        _ = try normalizer.consume(frame("response.output_text.delta", ["delta": "A public explanation."]))
        let event = try normalizer.consume(completion())
        guard case let .completed(result) = event else { return XCTFail("Expected completed public search") }
        XCTAssertEqual(result.text, "A public explanation.")
        XCTAssertEqual(result.webSearch?.callCount, 1)
        XCTAssertEqual(result.webSearch?.citations, [ChatGPTWebCitation(url: "https://example.org/source", title: "Synthetic public source")])
        XCTAssertTrue(result.toolCalls.isEmpty)
        XCTAssertTrue(result.continuationItems.isEmpty)
    }

    func testOrdinaryPrivateResponseStillRejectsHostedSearch() {
        var normalizer = ResponsesEventNormalizer(requestID: nil)
        XCTAssertThrowsError(try addSearch(&normalizer, id: "ws_1"))
        XCTAssertThrowsError(try normalizer.consume(completion()))
    }

    func testExcessOrDuplicateObservedSearchRequestsFailImmediately() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        try addSearch(&normalizer, id: "ws_1")
        try addSearch(&normalizer, id: "ws_2")
        XCTAssertThrowsError(try addSearch(&normalizer, id: "ws_3"))
        var duplicate = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        try addSearch(&duplicate, id: "ws_1")
        XCTAssertThrowsError(try addSearch(&duplicate, id: "ws_1"))
    }

    func testPublicTextHasAnObservedByteBound() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        XCTAssertThrowsError(try normalizer.consume(frame("response.output_text.delta", [
            "delta": String(repeating: "a", count: ResponsesPublicWebSearch.maxTextBytes + 1),
        ])))
    }

    func testMalformedAndMissingCitationDataCannotBecomeSearchEvidence() throws {
        let invalid: [[String: Any]] = [
            ["url": "file:///private/source"], ["url": "https://user:secret@example.org"],
            ["title": ""], ["start_index": true], ["end_index": 1000], ["end_index": 0],
        ]
        for patch in invalid {
            var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
            _ = try normalizer.consume(frame("response.output_text.delta", ["delta": "A public explanation."]))
            XCTAssertThrowsError(try normalizer.consume(completion(citationPatch: patch)))
        }
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        _ = try normalizer.consume(frame("response.output_text.delta", ["delta": "A public explanation."]))
        XCTAssertThrowsError(try normalizer.consume(completion(annotations: [])))
    }

    func testPublicSearchRejectsFunctionCallsAndUnmatchedCompletionText() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        XCTAssertThrowsError(try normalizer.consume(frame("response.output_item.added", [
            "item": ["type": "function_call", "id": "private-call"],
        ])))
        var mismatched = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        _ = try mismatched.consume(frame("response.output_text.delta", ["delta": "Different text"]))
        XCTAssertThrowsError(try mismatched.consume(completion()))
    }

    private func addSearch(_ normalizer: inout ResponsesEventNormalizer, id: String) throws {
        _ = try normalizer.consume(frame("response.output_item.added", [
            "output_index": id == "ws_1" ? 0 : 1,
            "item": ["type": "web_search_call", "id": id, "status": "in_progress"],
        ]))
    }

    private func completion(citationPatch: [String: Any] = [:], annotations: [[String: Any]]? = nil) -> ResponsesSSEFrame {
        var citation: [String: Any] = [
            "type": "url_citation", "url": "https://example.org/source", "title": "Synthetic public source",
            "start_index": 0, "end_index": 10,
        ]
        citation.merge(citationPatch) { _, new in new }
        return frame("response.completed", ["response": [
            "status": "completed", "output": [
                ["type": "web_search_call", "id": "ws_1", "status": "completed", "action": ["type": "search"]],
                ["type": "message", "content": [[
                    "type": "output_text", "text": "A public explanation.", "annotations": annotations ?? [citation],
                ]]],
            ],
        ]])
    }

    private func frame(_ type: String, _ fields: [String: Any]) -> ResponsesSSEFrame {
        var object = fields
        object["type"] = type
        let data = try! JSONSerialization.data(withJSONObject: object)
        return ResponsesSSEFrame(event: type, data: String(decoding: data, as: UTF8.self))
    }
}
