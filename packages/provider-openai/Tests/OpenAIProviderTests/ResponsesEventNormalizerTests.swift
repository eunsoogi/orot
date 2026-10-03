import Foundation
import XCTest
@testable import OpenAIProvider

final class ResponsesEventNormalizerTests: XCTestCase {
    func testOnlyCompletedTerminalReturnsACompletedResponse() throws {
        var normalizer = ResponsesEventNormalizer(requestID: "req_fixture")
        let delta = try normalizer.consume(frame("response.output_text.delta", #"{"type":"response.output_text.delta","delta":"Hello"}"#))
        XCTAssertEqual(delta, .textDelta("Hello"))
        XCTAssertNil(try normalizer.consume(ResponsesSSEFrame(event: nil, data: "[DONE]")))
        XCTAssertFalse(normalizer.completed)

        let completed = try normalizer.consume(frame("response.completed", #"{"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}]}}"#))
        XCTAssertEqual(completed, .completed(ChatGPTResponsesResult(text: "Hello")))
        XCTAssertTrue(normalizer.completed)
    }

    func testIncompleteTerminalRemainsAnErrorWithReason() {
        var normalizer = ResponsesEventNormalizer(requestID: "req_incomplete")
        XCTAssertThrowsError(try normalizer.consume(frame(
            "response.incomplete",
            #"{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}"#
        ))) { error in
            guard case .incomplete(let diagnostics) = error as? ChatGPTResponsesError else {
                return XCTFail("Expected incomplete response error, got \(error).")
            }
            XCTAssertEqual(diagnostics.reason, "max_output_tokens")
            XCTAssertEqual(diagnostics.requestID, "req_incomplete")
        }
    }

    func testFailedTerminalPreservesSubscriptionUsageCodeAndParameter() {
        var normalizer = ResponsesEventNormalizer(requestID: "req_usage")
        XCTAssertThrowsError(try normalizer.consume(frame(
            "response.failed",
            #"{"type":"response.failed","response":{"status":"failed","error":{"code":"subscription_sharing_usage_limit_exceeded","param":"model"}}}"#
        ))) { error in
            guard case .responseFailure(let diagnostics) = error as? ChatGPTResponsesError else {
                return XCTFail("Expected response failure, got \(error).")
            }
            XCTAssertEqual(diagnostics.code, "subscription_sharing_usage_limit_exceeded")
            XCTAssertEqual(diagnostics.parameter, "model")
            XCTAssertEqual(diagnostics.requestID, "req_usage")
        }
    }

    func testTopLevelErrorEventsPreserveProviderSpecificCodesAndParameters() {
        let cases = [
            ("subscription_sharing_usage_limit_exceeded", "model"),
            ("chatpass_v2_scope_not_authorized", "model"),
            ("subscription_sharing_unsupported_capability", "tools"),
        ]
        for (code, parameter) in cases {
            var normalizer = ResponsesEventNormalizer(requestID: "req_top_level_error")
            let payload = #"{"type":"error","code":"\#(code)","message":"Provider error","param":"\#(parameter)"}"#
            XCTAssertThrowsError(try normalizer.consume(frame("error", payload))) { error in
                guard case .responseFailure(let diagnostics) = error as? ChatGPTResponsesError else {
                    return XCTFail("Expected response failure, got \(error).")
                }
                XCTAssertEqual(diagnostics.bodyShape, "error_event")
                XCTAssertEqual(diagnostics.code, code)
                XCTAssertEqual(diagnostics.parameter, parameter)
                XCTAssertEqual(diagnostics.requestID, "req_top_level_error")
            }
        }
    }

    func testCompletedTextMustMatchTheEmittedDeltas() {
        var normalizer = ResponsesEventNormalizer(requestID: nil)
        _ = try? normalizer.consume(frame("response.output_text.delta", #"{"type":"response.output_text.delta","delta":"partial"}"#))
        XCTAssertThrowsError(try normalizer.consume(frame(
            "response.completed",
            #"{"type":"response.completed","response":{"status":"completed","output_text":"different"}}"#
        ))) { error in
            XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
        }
    }

    private func frame(_ event: String, _ data: String) -> ResponsesSSEFrame {
        ResponsesSSEFrame(event: event, data: data)
    }
}
