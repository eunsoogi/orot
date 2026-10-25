import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTResponsesRequestDecoderTests: XCTestCase {
    func testDecodesLocalToolsAndToolRoundTripMessages() throws {
        let payload = NSDictionary(dictionary: [
            "model": "gpt-test",
            "messages": [
                ["role": "user", "content": "Look up source-42."],
                ["type": "function_call", "callID": "call_1", "name": "lookup_source", "arguments": #"{"sourceId":"source-42"}"#],
                ["type": "function_call_output", "callID": "call_1", "output": #"{"found":true}"#],
                ["type": "continuation_item", "json": #"{"type":"reasoning","id":"rs_1"}"#],
            ],
            "tools": [[
                "type": "function",
                "name": "lookup_source",
                "description": "Look up one source.",
                "parameters": ["type": "object", "properties": ["sourceId": ["type": "string"]]],
                "strict": false,
            ]],
        ])

        let request = try ChatGPTResponsesRequestDecoder.decode(payload)

        XCTAssertEqual(request.model, "gpt-test")
        XCTAssertEqual(request.messages, [
            .user("Look up source-42."),
            .functionCall(callID: "call_1", name: "lookup_source", argumentsJSON: #"{"sourceId":"source-42"}"#),
            .functionCallOutput(callID: "call_1", output: #"{"found":true}"#),
            .continuationItem(json: #"{"type":"reasoning","id":"rs_1"}"#),
        ])
        XCTAssertEqual(request.tools, [ChatGPTResponsesToolDefinition(
            name: "lookup_source",
            description: "Look up one source.",
            parametersJSON: #"{"properties":{"sourceId":{"type":"string"}},"type":"object"}"#,
            strict: false,
        )])
    }

    func testRejectsHostedToolDefinitions() {
        let payload = NSDictionary(dictionary: [
            "model": "gpt-test",
            "messages": [["role": "user", "content": "Search the web."]],
            "tools": [["type": "web_search", "name": "search"]],
        ])

        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode(payload)) { error in
            XCTAssertEqual(error as? ChatGPTResponsesError, .unsupportedCapability("hosted tools"))
        }
    }
}
