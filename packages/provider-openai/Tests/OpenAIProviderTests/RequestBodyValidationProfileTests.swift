import Foundation
@testable import OpenAIProvider
import XCTest

/// Synthetic mapper-shaped requests only. No transport or account is used.
final class RequestBodyValidationProfileTests: XCTestCase {
    func testLargeToolFollowUpsBuildWithoutAnApplicationByteCeiling() throws {
        let cases = [
            [String(repeating: "x", count: 1_048_577)],
            [String(repeating: "가", count: 400_000)],
            Array(repeating: String(repeating: "x", count: 400_000), count: 3),
        ]
        for outputs in cases {
            var messages: [[String: String]] = [["role": "user", "content": "Synthetic request"]]
            for (index, output) in outputs.enumerated() {
                let callID = "synthetic-call-\(index)"
                messages.append(["type": "function_call", "callID": callID, "name": "synthetic_tool", "arguments": "{}"])
                messages.append(["type": "function_call_output", "callID": callID, "output": output])
            }
            let request = try ChatGPTResponsesRequestDecoder.decode(NSDictionary(dictionary: [
                "model": "synthetic-model", "messages": messages,
            ]))
            let body = try XCTUnwrap(ChatGPTResponsesRequestBuilder.build(request, accessToken: "synthetic-token").httpBody)
            XCTAssertGreaterThan(body.count, 1_048_576)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let input = try XCTUnwrap(object["input"] as? [[String: Any]])
            XCTAssertEqual(input.compactMap { $0["output"] as? String }, outputs)
        }
    }

    func testLargeSteeringInstructionsPreserveEveryByte() throws {
        for text in [String(repeating: "a", count: 16385), String(repeating: "가", count: 6000)] {
            var state = ResponsesSteeringState()
            let created = try JSONSerialization.data(withJSONObject: [
                "type": "response.created", "response": ["id": "synthetic-response", "status": "in_progress"],
            ])
            _ = try state.consume(created)
            let sent = try state.prepareSteer(submissionID: "synthetic-submission", text: text)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: sent) as? [String: Any])
            XCTAssertGreaterThan(text.utf8.count, 16384)
            XCTAssertEqual(object["input"] as? String, text)
            XCTAssertEqual(object["type"] as? String, "response.steer")
        }
    }

    func testMalformedContinuationStillFailsClosed() {
        for json in [
            #"{"type":"function_call"}"#,
            #"{"type":"function_call","id":"fc","call_id":"call","name":"tool","arguments":"[]"}"#,
            #"{"type":"function_call","id":"fc","call_id":"call","name":"tool","arguments":"null"}"#,
        ] {
            let request = ChatGPTResponsesRequest(model: "synthetic-model", messages: [.continuationItem(json: json)])
            XCTAssertThrowsError(try ChatGPTResponsesRequestBuilder.build(request, accessToken: "synthetic-token")) {
                XCTAssertEqual($0 as? ChatGPTResponsesError, .invalidRequest)
            }
        }
    }
}
