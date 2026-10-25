import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesEventNormalizerTests: XCTestCase {
    func testOnlyCompletedTerminalReturnsACompletedResponse() throws {
        var normalizer = ResponsesEventNormalizer(requestID: "req_fixture")
        let delta = try normalizer.consume(frame("response.output_text.delta", #"{"type":"response.output_text.delta","delta":"Hello"}"#))
        XCTAssertEqual(delta, .textDelta("Hello"))
        XCTAssertNil(try normalizer.consume(ResponsesSSEFrame(event: nil, data: "[DONE]")))
        XCTAssertFalse(normalizer.completed)

        let completed = try normalizer.consume(frame("response.completed", #"{"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}]}}"#))
        XCTAssertEqual(completed, .completed(ChatGPTResponsesResult(
            text: "Hello",
            continuationItems: [#"{"content":[{"text":"Hello","type":"output_text"}],"type":"message"}"#],
        )))
        XCTAssertTrue(normalizer.completed)
    }

    func testIncompleteTerminalRemainsAnErrorWithReason() {
        var normalizer = ResponsesEventNormalizer(requestID: "req_incomplete")
        XCTAssertThrowsError(try normalizer.consume(frame(
            "response.incomplete",
            #"{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}"#,
        ))) { error in
            guard case let .incomplete(diagnostics) = error as? ChatGPTResponsesError else {
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
            #"{"type":"response.failed","response":{"status":"failed","error":{"code":"subscription_sharing_usage_limit_exceeded","param":"model"}}}"#,
        ))) { error in
            guard case let .responseFailure(diagnostics) = error as? ChatGPTResponsesError else {
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
                guard case let .responseFailure(diagnostics) = error as? ChatGPTResponsesError else {
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
            #"{"type":"response.completed","response":{"status":"completed","output_text":"different"}}"#,
        ))) { error in
            XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
        }
    }

    func testFunctionCallArgumentsBecomeNormalizedCallsAndKeepContinuationItems() throws {
        var normalizer = ResponsesEventNormalizer(requestID: "req_tool")
        XCTAssertNil(try normalizer.consume(frame("response.output_item.added", #"{"type":"response.output_item.added","item":{"type":"function_call","id":"fc_synthetic","call_id":"call_synthetic","name":"lookup_source","arguments":""}}"#)))
        XCTAssertNil(try normalizer.consume(frame("response.function_call_arguments.delta", #"{"type":"response.function_call_arguments.delta","item_id":"fc_synthetic","delta":"{\"sourceId\":\"source-42\"}"}"#)))

        let argumentsDone = try XCTUnwrap(try normalizer.consume(frame(
            "response.function_call_arguments.done",
            #"{"type":"response.function_call_arguments.done","item_id":"fc_synthetic","arguments":"{\"sourceId\":\"source-42\"}"}"#,
        )))
        let call = ChatGPTResponsesFunctionCall(
            id: "call_synthetic",
            name: "lookup_source",
            argumentsJSON: #"{"sourceId":"source-42"}"#,
        )
        XCTAssertEqual(argumentsDone, .toolCall(call))

        let completed = try XCTUnwrap(try normalizer.consume(frame(
            "response.completed",
            #"{"type":"response.completed","response":{"status":"completed","output_text":"","output":[{"type":"reasoning","id":"rs_synthetic","encrypted_content":"opaque"},{"type":"function_call","id":"fc_synthetic","call_id":"call_synthetic","name":"lookup_source","arguments":"{\"sourceId\":\"source-42\"}"}]}}"#,
        )))
        guard case let .completed(result) = completed else { return XCTFail("Expected a completed tool response.") }
        XCTAssertEqual(result.text, "")
        XCTAssertEqual(result.toolCalls, [call])
        XCTAssertEqual(result.continuationItems.count, 2)
        let continuation = try result.continuationItems.map { json -> [String: Any] in
            let data = Data(json.utf8)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        XCTAssertEqual(continuation.map { $0["type"] as? String }, ["reasoning", "function_call"])
    }

    func testMalformedFunctionArgumentsAreRejected() {
        var normalizer = ResponsesEventNormalizer(requestID: "req_bad_tool")
        _ = try? normalizer.consume(frame("response.output_item.added", #"{"type":"response.output_item.added","item":{"type":"function_call","id":"fc_bad","call_id":"call_bad","name":"lookup_source","arguments":""}}"#))
        XCTAssertThrowsError(try normalizer.consume(frame(
            "response.function_call_arguments.done",
            #"{"type":"response.function_call_arguments.done","item_id":"fc_bad","arguments":"[]"}"#,
        ))) { error in
            XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
        }
    }

    func testHostedToolOutputIsRejectedExplicitly() {
        var normalizer = ResponsesEventNormalizer(requestID: "req_hosted_tool")
        XCTAssertThrowsError(try normalizer.consume(frame(
            "response.output_item.added",
            #"{"type":"response.output_item.added","item":{"type":"web_search_call","id":"ws_1"}}"#,
        ))) { error in
            XCTAssertEqual(error as? ChatGPTResponsesError, .unsupportedCapability("hosted tools"))
        }
    }

    private func frame(_ event: String, _ data: String) -> ResponsesSSEFrame {
        ResponsesSSEFrame(event: event, data: data)
    }
}
