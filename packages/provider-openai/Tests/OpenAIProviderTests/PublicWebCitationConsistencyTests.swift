import Foundation
@testable import OpenAIProvider
import XCTest

final class PublicWebCitationConsistencyTests: XCTestCase {
    func testCannotAttachAnAnnotatedBodyToDifferentStreamedAndTopLevelText() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        _ = try normalizer.consume(frame("response.output_text.delta", ["delta": "Streamed explanation A."]))
        XCTAssertThrowsError(try normalizer.consume(completion(
            top: "Streamed explanation A.", body: "Annotated explanation B.", publicSearch: true,
        )))
        XCTAssertFalse(normalizer.completed)
    }

    func testMatchingAnnotatedBodyAndTopLevelTextRetainActualCitations() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        _ = try normalizer.consume(frame("response.output_text.delta", ["delta": "Annotated explanation."]))
        let event = try normalizer.consume(completion(
            top: "Annotated explanation.", body: "Annotated explanation.", publicSearch: true,
        ))
        guard case let .completed(result) = event else { return XCTFail("Expected a public result") }
        XCTAssertEqual(result.text, "Annotated explanation.")
        XCTAssertEqual(result.webSearch?.citations.first?.url, "https://example.org/source")
    }

    func testAnInconsistentTopLevelTextCannotOverrideMatchingAnnotatedBodyAndStream() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: true)
        _ = try normalizer.consume(frame("response.output_text.delta", ["delta": "Annotated explanation."]))
        XCTAssertThrowsError(try normalizer.consume(completion(
            top: "Different explanation.", body: "Annotated explanation.", publicSearch: true,
        )))
    }

    func testOrdinaryPrivateCompletionRetainsItsExistingPositivePath() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil)
        _ = try normalizer.consume(frame("response.output_text.delta", ["delta": "Private response."]))
        let event = try normalizer.consume(completion(
            top: "Private response.", body: "Private response.", publicSearch: false,
        ))
        guard case let .completed(result) = event else { return XCTFail("Expected a private result") }
        XCTAssertEqual(result.text, "Private response.")
        XCTAssertNil(result.webSearch)
    }

    private func completion(top: String, body: String, publicSearch: Bool) -> ResponsesSSEFrame {
        var output = [[String: Any]]()
        if publicSearch {
            output.append([
                "type": "web_search_call", "id": "ws_fixture", "status": "completed",
                "action": ["type": "search"],
            ])
        }
        output.append(["type": "message", "content": [[
            "type": "output_text", "text": body, "annotations": [[
                "type": "url_citation", "url": "https://example.org/source", "title": "Synthetic source",
                "start_index": 0, "end_index": 10,
            ]],
        ]]])
        return frame("response.completed", ["response": [
            "status": "completed", "output_text": top, "output": output,
        ]])
    }

    private func frame(_ type: String, _ fields: [String: Any]) -> ResponsesSSEFrame {
        var object = fields
        object["type"] = type
        let data = try! JSONSerialization.data(withJSONObject: object)
        return ResponsesSSEFrame(event: type, data: String(decoding: data, as: UTF8.self))
    }
}
