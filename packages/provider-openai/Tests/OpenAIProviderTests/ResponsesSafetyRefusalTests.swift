import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesSafetyRefusalTests: XCTestCase {
    /// Exercise the actual stream normalizer, including completed snapshots without deltas.
    func testRefusalNeverBecomesSearchTextOrUnavailableEvidence() throws {
        let cases: [[String: Any]] = [
            ["type": "response.refusal.delta", "delta": "Synthetic refusal"],
            ["type": "response.refusal.done", "refusal": "Synthetic refusal"],
            ["type": "response.content_part.done", "part": ["type": "refusal"]],
            ["type": "response.output_item.done", "item": ["type": "message", "content": [["type": "refusal"]]]],
            ["type": "response.completed", "response": ["status": "completed", "output": [["type": "message", "content": [["type": "refusal", "refusal": "Synthetic refusal"]]]]]],
            ["type": "response.incomplete", "response": ["incomplete_details": ["reason": "content_filter"]]],
        ]
        for publicSearch in [false, true] {
            for object in cases {
                var normalizer = ResponsesEventNormalizer(requestID: nil, publicWebSearch: publicSearch)
                let data = try JSONSerialization.data(withJSONObject: object)
                XCTAssertThrowsError(try normalizer.consume(ResponsesSSEFrame(event: nil, data: String(decoding: data, as: UTF8.self)))) { error in
                    XCTAssertEqual(error as? ChatGPTResponsesError, .responseFailure(ChatGPTResponsesDiagnostics(code: "safety_refusal")))
                }
                XCTAssertEqual(normalizer.accumulatedText, "")
                XCTAssertFalse(normalizer.completed)
            }
        }
    }
}
