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

    /// The bridge keeps instructions and tool schemas stable without asking the provider
    /// to remember a request. Only the explicit, normalized cold replay appears in history.
    func testStableInstructionsAndOrderedToolsAcrossCurrentRequestsAndColdReplay() throws {
        struct StorageFlag: Decodable {
            let store: Bool
        }

        let firstSystem = "Use public example facts only."
        let secondSystem = "Return the example in reading order."
        let instructions = [firstSystem, secondSystem].joined(separator: "\n\n")
        let system: [[String: Any]] = [
            ["role": "system", "content": firstSystem],
            ["role": "system", "content": secondSystem],
        ]
        let toolsJSON = #"""
        [
          {
            "type": "function", "name": "resolve_public_example", "description": "Resolve the public example.",
            "strict": false,
            "parameters": {
              "type": "object", "required": ["query"], "additionalProperties": false,
              "properties": {"query": {
                "type": "object", "required": ["subject"],
                "properties": {"subject": {"type": "string", "enum": ["triangle", "square"]}}
              }}
            }
          },
          {
            "type": "function", "name": "count_public_examples", "strict": false,
            "parameters": {
              "type": "object", "required": ["shapes"],
              "properties": {"shapes": {
                "type": "array", "items": {"type": "object", "properties": {"sides": {"type": "integer"}}}
              }}
            }
          }
        ]
        """#
        let tools = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(toolsJSON.utf8)) as? [[String: Any]])
        let historicalQuestion = "Use the public triangle example."
        let historicalAssistant = "I will look up the public example."
        let callID = "synthetic_call_public_triangle"
        let arguments = #"{"query":{"subject":"triangle"}}"#
        let output = #"{"sides":3}"#
        // The bridge uses callID; the HTTP contract uses call_id. This is
        // normalized input, not an opaque continuation or server-side chain.
        let replay: [[String: Any]] = [
            ["role": "user", "content": historicalQuestion],
            ["role": "assistant", "content": historicalAssistant],
            ["type": "function_call", "callID": callID, "name": "resolve_public_example", "arguments": arguments],
            ["type": "function_call_output", "callID": callID, "output": output],
        ]
        let wireReplay: [[String: Any]] = [
            ["role": "user", "content": historicalQuestion],
            ["role": "assistant", "content": historicalAssistant],
            ["type": "function_call", "call_id": callID, "name": "resolve_public_example", "arguments": arguments],
            ["type": "function_call_output", "call_id": callID, "output": output],
        ]
        let examples = [
            (current: "Explain a public square.", scope: "native-synthetic-scope-a", cold: false),
            (current: "Explain a public hexagon.", scope: "native-synthetic-scope-b", cold: false),
            (current: "Compare the public examples.", scope: "native-synthetic-scope-c", cold: true),
        ]
        for example in examples {
            let current: [[String: Any]] = [["role": "user", "content": example.current]]
            let bridge = NSDictionary(dictionary: [
                "model": "gpt-test",
                "messages": system + (example.cold ? replay : []) + current,
                "tools": tools,
                "transportScope": example.scope,
            ])
            let decoded = try ChatGPTResponsesRequestDecoder.decode(bridge)
            XCTAssertEqual(decoded.transportScope, example.scope)
            let request = try ChatGPTResponsesRequestBuilder.build(decoded, accessToken: "synthetic")
            let data = try XCTUnwrap(request.httpBody)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

            // Foundation container equality compares objects structurally while retaining array order.
            XCTAssertEqual(body["instructions"] as? String, instructions)
            XCTAssertEqual(try XCTUnwrap(body["tools"] as? NSArray), tools as NSArray)
            XCTAssertEqual(try XCTUnwrap(body["input"] as? NSArray), ((example.cold ? wireReplay : []) + current) as NSArray)
            XCTAssertFalse(try JSONDecoder().decode(StorageFlag.self, from: data).store)
            XCTAssertNil(body["previous_response_id"])
            XCTAssertNil(body["prompt_cache_key"])
            XCTAssertNil(body["transportScope"])
            XCTAssertFalse(String(decoding: data, as: UTF8.self).contains(example.scope))
            XCTAssertFalse((request.allHTTPHeaderFields ?? [:]).values.contains { $0.contains(example.scope) })
        }
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
