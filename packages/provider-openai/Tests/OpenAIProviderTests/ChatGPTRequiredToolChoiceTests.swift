import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTRequiredToolChoiceTests: XCTestCase {
    /// Verify the bridge and HTTP body, not merely the TypeScript request shape.
    func testRequiredSelectionReachesHTTPAndDisablesParallelCalls() throws {
        let payload: NSDictionary = [
            "model": "synthetic",
            "messages": [["role": "user", "content": "Read synthetic records."]],
            "toolChoice": "required",
            "tools": [["type": "function", "name": "read_records", "strict": false,
                       "parameters": ["type": "object", "properties": [:]]]],
        ]
        let decoded = try ChatGPTResponsesRequestDecoder.decode(payload)
        let request = try ChatGPTResponsesRequestBuilder.build(decoded, accessToken: "synthetic-token")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["tool_choice"] as? String, "required")
        XCTAssertEqual(body["parallel_tool_calls"] as? Bool, false)
    }

    func testRequiredSelectionWithoutToolsIsRejected() {
        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
            "model": "synthetic", "messages": [["role": "user", "content": "Synthetic"]],
            "toolChoice": "required",
        ]))
    }
}
