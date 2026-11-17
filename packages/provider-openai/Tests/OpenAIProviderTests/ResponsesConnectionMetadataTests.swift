import Foundation
@testable import OpenAIProvider
import XCTest

/// Only synthetic protocol fixtures. The public client documents this metadata
/// event independently of any private diagnostic observation.
final class ResponsesConnectionMetadataTests: XCTestCase {
    func testMetadataBeforeAndAfterCreationDoesNotBecomeReadyOrAnswer() throws {
        var state = ResponsesSteeringState()
        XCTAssertEqual(try state.consume(metadata()), [])
        XCTAssertFalse(state.finished)
        XCTAssertThrowsError(try state.prepareSteer(submissionID: "local", text: "Update"))
        XCTAssertEqual(try state.consume(created()), [.ready, .response(.responseStarted("original"))])
        XCTAssertEqual(try state.consume(metadata(["response_id": "original"])), [])
        XCTAssertFalse(state.finished)
        let events = try state.consume(event(["type": "response.completed", "response": [
            "id": "original", "status": "completed", "output": [],
        ]]))
        XCTAssertEqual(events.count, 1)
        guard case .response(.completed) = events.first else { return XCTFail("Expected completion") }
        XCTAssertTrue(state.finished)
        XCTAssertThrowsError(try state.consume(metadata()))
    }

    func testUnknownPreResponseEventsRemainRejected() throws {
        for type in ["synthetic.unknown", "codex.response.metadata.extra", "response.output_text.delta"] {
            var state = ResponsesSteeringState()
            XCTAssertThrowsError(try state.consume(event(["type": type, "delta": "synthetic"]))) { error in
                XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
            }
        }
    }

    func testMetadataCannotBypassResponseIdentityValidation() throws {
        for fields: [String: Any] in [["response_id": "foreign"], ["response": ["id": "foreign"]], ["response_id": 7]] {
            var state = ResponsesSteeringState()
            _ = try state.consume(created())
            XCTAssertThrowsError(try state.consume(metadata(fields))) { error in
                XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
            }
        }
    }

    func testMetadataCannotHideSafetyRefusalBeforeOrAfterCreation() throws {
        for started in [false, true] {
            var state = ResponsesSteeringState()
            if started { _ = try state.consume(created()) }
            XCTAssertThrowsError(try state.consume(metadata(["part": ["type": "refusal"]]))) { error in
                guard case let ChatGPTResponsesError.responseFailure(details) = error else {
                    return XCTFail("Expected terminal refusal")
                }
                XCTAssertEqual(details.code, "safety_refusal")
            }
        }
    }

    func testMetadataStillValidatesWhileOriginalCompletionAwaitsSteering() throws {
        for fields: [String: Any] in [["response_id": "foreign"], ["response_id": 7], ["part": ["type": "refusal"]]] {
            var state = ResponsesSteeringState()
            _ = try state.consume(created())
            _ = try state.prepareSteer(submissionID: "local", text: "Update")
            XCTAssertEqual(try state.consume(event(["type": "response.completed", "response": [
                "id": "original", "status": "completed", "output": [],
            ]])), [])
            XCTAssertFalse(state.finished)
            XCTAssertEqual(try state.consume(metadata()), [])
            XCTAssertThrowsError(try state.consume(metadata(fields)))
            XCTAssertFalse(state.finished)
        }
    }

    private func metadata(_ fields: [String: Any] = [:]) throws -> Data {
        var value = fields
        value["type"] = "codex.response.metadata"
        value["headers"] = ["x-models-etag": "synthetic"]
        return try event(value)
    }

    private func created() throws -> Data {
        try event(["type": "response.created", "response": ["id": "original", "status": "in_progress"]])
    }

    private func event(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value)
    }
}
