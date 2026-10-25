import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesUsageTests: XCTestCase {
    func testTerminalUsageCopiesReportedCountsIntoTheNativePayload() throws {
        var normalizer = ResponsesEventNormalizer(requestID: "synthetic-usage")
        let event = try normalizer.consume(completion([
            "input_tokens": 123,
            "output_tokens": 17,
            "total_tokens": 140,
            "input_tokens_details": ["cached_tokens": 20],
        ]))
        guard case let .completed(result) = event else { return XCTFail("Expected terminal result.") }
        XCTAssertEqual(result.usage, ChatGPTResponsesUsage(inputTokens: 123, outputTokens: 17, totalTokens: 140))
        XCTAssertEqual(result.usage?.nativePayload, ["inputTokens": 123, "outputTokens": 17, "totalTokens": 140])
        XCTAssertEqual(result.text, "")
    }

    func testZeroCountsAreReportedCountsAndNotMissingValues() throws {
        let usage = try ChatGPTResponsesUsage.decode(["input_tokens": 0, "output_tokens": 0, "total_tokens": 0])
        XCTAssertEqual(usage?.nativePayload, ["inputTokens": 0, "outputTokens": 0, "totalTokens": 0])
    }

    func testMissingAndNullUsageRemainAbsent() throws {
        let absent: [Any?] = [nil, NSNull()]
        for value in absent {
            var normalizer = ResponsesEventNormalizer(requestID: "synthetic-no-usage")
            let event = try normalizer.consume(completion(value))
            guard case let .completed(result) = event else { return XCTFail("Expected terminal result.") }
            XCTAssertNil(result.usage)
        }
    }

    func testMalformedOrPartialUsageDoesNotBecomeACompletedResult() throws {
        let invalid: [Any] = [
            [], "usage", true,
            ["input_tokens": 4, "output_tokens": 2],
            ["input_tokens": true, "output_tokens": 2, "total_tokens": 3],
            ["input_tokens": "4", "output_tokens": 2, "total_tokens": 6],
            ["input_tokens": -1, "output_tokens": 2, "total_tokens": 1],
            ["input_tokens": 1.5, "output_tokens": 2, "total_tokens": 3.5],
            ["input_tokens": 9_007_199_254_740_992, "output_tokens": 0, "total_tokens": 9_007_199_254_740_992],
        ]
        for value in invalid {
            var normalizer = ResponsesEventNormalizer(requestID: "synthetic-invalid-usage")
            XCTAssertThrowsError(try normalizer.consume(completion(value))) { error in
                XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
            }
            XCTAssertFalse(normalizer.completed)
        }
    }

    func testEarlierUsageDoesNotInventTerminalCounts() throws {
        var normalizer = ResponsesEventNormalizer(requestID: "synthetic-terminal-only")
        let earlier = #"{"type":"response.created","response":{"usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}"#
        XCTAssertNil(try normalizer.consume(ResponsesSSEFrame(event: "response.created", data: earlier)))
        guard case let .completed(result) = try normalizer.consume(completion(nil)) else {
            return XCTFail("Expected terminal result.")
        }
        XCTAssertNil(result.usage)
    }

    private func completion(_ usage: Any?) throws -> ResponsesSSEFrame {
        var response: [String: Any] = ["status": "completed", "output_text": "", "output": []]
        if let usage {
            response["usage"] = usage
        }
        let data = try JSONSerialization.data(withJSONObject: ["type": "response.completed", "response": response])
        return ResponsesSSEFrame(event: "response.completed", data: String(decoding: data, as: UTF8.self))
    }
}
