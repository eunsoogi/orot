import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesSteeringStateTests: XCTestCase {
    func testAcceptanceIsNotApplicationAndSuccessorCreationCommitsOnce() throws {
        var state = ResponsesSteeringState()
        XCTAssertEqual(try state.consume(created("original")), [.ready])
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

    func testSteeringRequiresCreatedResponseAndBoundedUserText() throws {
        var state = ResponsesSteeringState()
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "local", text: "Update"))
        _ = try state.consume(created("original"))
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "local", text: "  "))
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "local", text: String(repeating: "a", count: 16385)))
        XCTAssertTrue(ChatGPTSteerableResponse.supportsModel("gpt-6-astra"))
        XCTAssertFalse(ChatGPTSteerableResponse.supportsModel("gpt-60"))
        XCTAssertFalse(ChatGPTSteerableResponse.supportsModel("gpt-5.6"))
    }

    private func event(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value)
    }

    private func created(_ id: String, previous: String? = nil) throws -> Data {
        var response = ["id": id]
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
