import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesCompletedItemsTests: XCTestCase {
    private let call: [String: Any] = [
        "type": "function_call", "id": "fc_fixture", "call_id": "call_fixture",
        "name": "read_records", "arguments": "{\"query\":\"blood pressure\"}",
    ]

    func testEmptyTerminalOutputUsesEveryCompletedOutputItem() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil)
        let reasoning: [String: Any] = ["type": "reasoning", "id": "rs_fixture", "encrypted_content": "opaque-fixture"]
        try add(reasoning, index: 0, to: &normalizer)
        try done(reasoning, index: 0, to: &normalizer)
        var initial = call
        initial["arguments"] = ""
        try add(initial, index: 1, to: &normalizer)
        _ = try normalizer.consume(event("response.function_call_arguments.done", [
            "item_id": "fc_fixture", "arguments": XCTUnwrap(call["arguments"]),
        ]))
        try done(call, index: 1, to: &normalizer)

        guard case let .completed(result) = try complete(&normalizer) else {
            return XCTFail("Expected a completed response assembled from completed stream items.")
        }
        XCTAssertEqual(result.toolCalls, try [.init(id: "call_fixture", name: "read_records", argumentsJSON: XCTUnwrap(call["arguments"] as? String))])
        XCTAssertEqual(result.continuationItems.count, 2)
        let first = try JSONSerialization.jsonObject(with: Data(result.continuationItems[0].utf8)) as? [String: String]
        XCTAssertEqual(first?["encrypted_content"], "opaque-fixture")
    }

    func testEmptyTerminalCannotPromoteAnUnfinishedItem() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil)
        try add(call, index: 0, to: &normalizer)
        XCTAssertThrowsError(try complete(&normalizer))
    }

    func testEmptyTerminalRejectsConflictingCallsAndMissingIndices() throws {
        for invalidIndex in [0, 2] {
            var normalizer = ResponsesEventNormalizer(requestID: nil)
            try add(call, index: 0, to: &normalizer)
            var changed = call
            changed["arguments"] = "{\"query\":\"different topic\"}"
            try done(changed, index: invalidIndex, to: &normalizer)
            XCTAssertThrowsError(try complete(&normalizer))
        }
    }

    func testCompletedItemsStillRequireSuccessfulResponseTerminal() throws {
        var normalizer = ResponsesEventNormalizer(requestID: nil)
        try add(call, index: 0, to: &normalizer)
        try done(call, index: 0, to: &normalizer)
        XCTAssertFalse(normalizer.completed)
        XCTAssertThrowsError(try normalizer.consume(event("response.failed", ["response": ["status": "failed"]])))
        XCTAssertFalse(normalizer.completed)
    }

    private func add(_ item: [String: Any], index: Int, to normalizer: inout ResponsesEventNormalizer) throws {
        _ = try normalizer.consume(event("response.output_item.added", ["output_index": index, "item": item]))
    }

    private func done(_ item: [String: Any], index: Int, to normalizer: inout ResponsesEventNormalizer) throws {
        _ = try normalizer.consume(event("response.output_item.done", ["output_index": index, "item": item]))
    }

    private func complete(_ normalizer: inout ResponsesEventNormalizer) throws -> ChatGPTResponsesEvent? {
        try normalizer.consume(event("response.completed", ["response": ["status": "completed", "output": []]]))
    }

    private func event(_ type: String, _ values: [String: Any]) throws -> ResponsesSSEFrame {
        var object = values
        object["type"] = type
        let data = try JSONSerialization.data(withJSONObject: object)
        return ResponsesSSEFrame(event: type, data: String(decoding: data, as: UTF8.self))
    }
}
