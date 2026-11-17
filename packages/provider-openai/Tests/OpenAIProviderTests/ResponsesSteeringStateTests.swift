import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesSteeringStateTests: XCTestCase {
    func testAcceptanceIsNotApplicationAndSuccessorCreationCommitsOnce() throws {
        var state = ResponsesSteeringState()
        XCTAssertEqual(try state.consume(created("original")), [.ready, .response(.responseStarted("original"))])
        let sent = try state.prepareSteer(submissionID: "local", text: "Use a concise answer")
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: sent) as? [String: String])
        XCTAssertEqual(payload, ["type": "response.steer", "previous_response_id": "original", "input": "Use a concise answer"])
        XCTAssertEqual(try state.consume(steer("accepted")), [.steering(submissionID: "local", status: "accepted", steerID: "server")])
        XCTAssertFalse(state.finished)
        XCTAssertEqual(try state.consume(event(["type": "response.incomplete", "response": [
            "id": "original", "incomplete_details": ["reason": "steered"],
        ]])), [])
        XCTAssertEqual(try state.consume(created("successor", previous: "original")), [
            .steering(submissionID: "local", status: "applied", steerID: "server"), .textSnapshot(""),
        ])
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "second", text: "Again"))
        let events = try state.consume(completed("successor"))
        XCTAssertEqual(events.count, 1)
        XCTAssertTrue(state.finished)
    }

    func testCompletionBeforeAcceptanceWaitsAndPendingPrecedesOriginalResult() throws {
        var state = ResponsesSteeringState()
        _ = try state.consume(created("original"))
        _ = try state.prepareSteer(submissionID: "local", text: "Update")
        XCTAssertEqual(try state.consume(completed("original")), [])
        _ = try state.consume(steer("accepted"))
        let events = try state.consume(steer("pending"))
        XCTAssertEqual(events.first, .steering(submissionID: "local", status: "pending", steerID: "server"))
        XCTAssertEqual(events.count, 2)
        XCTAssertTrue(state.finished)
    }

    func testFailedSteerDoesNotSwallowOriginalCompletionOrAllowReplay() throws {
        var state = ResponsesSteeringState()
        _ = try state.consume(created("original"))
        _ = try state.prepareSteer(submissionID: "local", text: "Update")
        XCTAssertEqual(try state.consume(steer("failed")), [.steering(submissionID: "local", status: "failed", steerID: "server")])
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "local", text: "Update"))
        XCTAssertEqual(try state.consume(completed("original")).count, 1)
        XCTAssertTrue(state.finished)
    }

    func testUncorrelatedAcknowledgementAndSuccessorAreRejected() throws {
        var state = ResponsesSteeringState()
        _ = try state.consume(created("original"))
        XCTAssertThrowsError(try state.consume(created("unsolicited")))
        _ = try state.prepareSteer(submissionID: "local", text: "Update")
        XCTAssertThrowsError(try state.consume(steer("accepted", target: "foreign")))
        _ = try state.consume(steer("accepted"))
        XCTAssertThrowsError(try state.consume(created("successor", previous: "foreign")))
    }

    func testSteeringRequiresCreatedResponseAndNonemptyUserText() throws {
        var state = ResponsesSteeringState()
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "local", text: "Update"))
        _ = try state.consume(created("original"))
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "local", text: "  "))
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "", text: "Update"))
        XCTAssertThrowsError(try state.prepareSteer(submissionID: String(repeating: "i", count: 129), text: "Update"))
        let text = String(repeating: "a", count: 16385)
        let sent = try state.prepareSteer(submissionID: "local", text: text)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: sent) as? [String: Any])
        XCTAssertEqual(object["input"] as? String, text)
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "second", text: "Update"))
        XCTAssertTrue(ChatGPTSteerableResponse.supportsModel("gpt-6-astra"))
        XCTAssertFalse(ChatGPTSteerableResponse.supportsModel("gpt-60"))
        XCTAssertFalse(ChatGPTSteerableResponse.supportsModel("gpt-5.6"))
    }

    func testSteeredCacheUsageRequiresBothReportedCounts() throws {
        let pairs: [(Int?, Int?)] = [(2, 3), (0, 0), (nil, 3), (2, nil)]
        for pair in pairs {
            var state = ResponsesSteeringState()
            _ = try state.consume(created("original"))
            _ = try state.prepareSteer(submissionID: "local", text: "Update")
            _ = try state.consume(steer("accepted"))
            func usage(_ cached: Int?) -> [String: Any] {
                var value: [String: Any] = ["input_tokens": 5, "output_tokens": 1, "total_tokens": 6]
                if let cached {
                    value["input_tokens_details"] = ["cached_tokens": cached]
                }
                return value
            }
            _ = try state.consume(event(["type": "response.incomplete", "response": [
                "id": "original", "incomplete_details": ["reason": "steered"], "usage": usage(pair.0),
            ]]))
            _ = try state.consume(created("successor", previous: "original"))
            let events = try state.consume(event(["type": "response.completed", "response": [
                "id": "successor", "status": "completed", "output": [], "usage": usage(pair.1),
            ]]))
            guard case let .response(.completed(result)) = events.last else { return XCTFail("Expected completion") }
            XCTAssertEqual(result.usage?.inputTokens, 10)
            XCTAssertEqual(result.usage?.cachedInputTokens, pair.0.flatMap { first in pair.1.map { first + $0 } })
        }
    }

    private func event(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value)
    }

    private func created(_ id: String, previous: String? = nil) throws -> Data {
        var response = ["id": id, "status": "in_progress"]
        if let previous {
            response["previous_response_id"] = previous
        }
        return try event(["type": "response.created", "response": response])
    }

    private func completed(_ id: String) throws -> Data {
        try event(["type": "response.completed", "response": ["id": id, "status": "completed", "output": []]])
    }

    private func steer(_ status: String, target: String = "original") throws -> Data {
        try event(["type": "response.steer.\(status)", "steer": ["id": "server", "previous_response_id": target]])
    }
}
