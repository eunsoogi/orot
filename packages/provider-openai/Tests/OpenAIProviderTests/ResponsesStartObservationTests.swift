import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesStartObservationTests: XCTestCase {
    func testQueuedIsNotProcessingAndFirstInProgressEmitsOnce() throws {
        var normalizer = ResponsesEventNormalizer(requestID: "request")
        XCTAssertNil(try normalizer.consume(frame("response.created", id: "response", status: "queued")))
        XCTAssertEqual(try normalizer.consume(frame("response.in_progress", id: "response")), .responseStarted("response"))
        XCTAssertNil(try normalizer.consume(frame("response.in_progress", id: "response")))
        XCTAssertThrowsError(try normalizer.consume(frame("response.in_progress", id: "foreign")))
    }

    func testCreatedInProgressEmitsWithoutWaitingForText() throws {
        var normalizer = ResponsesEventNormalizer(requestID: "request")
        XCTAssertEqual(try normalizer.consume(frame("response.created", id: "response")), .responseStarted("response"))
        XCTAssertEqual(normalizer.accumulatedText, "")
        XCTAssertNil(try normalizer.consume(frame("response.in_progress", id: "response")))
    }

    func testMalformedAndMismatchedIdentitiesCannotCreateReceipts() throws {
        for value in [
            ["type": "response.created"],
            ["type": "response.created", "response": ["status": "in_progress"]],
            ["type": "response.created", "response": ["id": " ", "status": "in_progress"]],
            ["type": "response.created", "response": ["id": "r", "status": "failed"]],
            ["type": "response.created", "response_id": "foreign", "response": ["id": "r", "status": "in_progress"]],
        ] as [[String: Any]] {
            var normalizer = ResponsesEventNormalizer(requestID: "request")
            let data = try JSONSerialization.data(withJSONObject: value)
            XCTAssertThrowsError(try normalizer.consume(ResponsesSSEFrame(event: nil, data: String(decoding: data, as: UTF8.self))))
        }
        var state = ResponsesSteeringState()
        let bad = try JSONSerialization.data(withJSONObject: ["type": "response.created", "response": ["id": "r"]])
        XCTAssertThrowsError(try state.consume(bad))
    }

    private func frame(_ type: String, id: String, status: String = "in_progress") throws -> ResponsesSSEFrame {
        let data = try JSONSerialization.data(withJSONObject: ["type": type, "response": ["id": id, "status": status]])
        return ResponsesSSEFrame(event: type, data: String(decoding: data, as: UTF8.self))
    }
}
