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

    /// A follow-up may answer or request another tool, but the runtime executes only one call per turn.
    func testContinuationWithoutRequiredChoiceDisablesParallelCalls() throws {
        let payload: NSDictionary = [
            "model": "synthetic",
            "messages": [
                ["role": "user", "content": "Read synthetic records."],
                ["type": "function_call", "callID": "call_1", "name": "read_records", "arguments": "{}"],
                ["type": "function_call_output", "callID": "call_1", "output": #"{"found":true}"#],
            ],
            "tools": [["type": "function", "name": "read_records", "strict": false,
                       "parameters": ["type": "object", "properties": [:]]]],
        ]
        let decoded = try ChatGPTResponsesRequestDecoder.decode(payload)
        let request = try ChatGPTResponsesRequestBuilder.build(decoded, accessToken: "synthetic-token")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertNil(body["tool_choice"])
        XCTAssertEqual(body["parallel_tool_calls"] as? Bool, false)
        let input = try XCTUnwrap(body["input"] as? [[String: Any]])
        XCTAssertEqual(input.last?["type"] as? String, "function_call_output")
        XCTAssertEqual(input.last?["call_id"] as? String, "call_1")
        XCTAssertEqual(input.last?["output"] as? String, #"{"found":true}"#)
    }

    func testRequiredSelectionWithoutToolsIsRejected() {
        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
            "model": "synthetic", "messages": [["role": "user", "content": "Synthetic"]],
            "toolChoice": "required",
        ]))
    }
}
