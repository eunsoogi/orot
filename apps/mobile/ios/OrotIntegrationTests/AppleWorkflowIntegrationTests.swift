import Foundation
@testable import Orot
import XCTest

/// Uses the shipping Apple bridge and workflows with raw model-response mocks and synthetic source/context boundaries.
final class AppleWorkflowIntegrationTests: OrotFailFastTestCase {
    func testThreeMockCalendarClassificationsAndTwoImportsKeepOneMedicalOccurrence() async throws {
        let result = try await TestOperationBroker.shared.request("calendar-classification")
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "mock-apple-calendar-classifications-and-two-imports"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(result["modelExecution"] as? String, "mock")
        XCTAssertEqual(result["actualModel"] as? String, "not-run")
        XCTAssertEqual(result["availability"] as? String, "available")
        let runs = try XCTUnwrap(result["runs"] as? [[String: Any]])
        XCTAssertEqual(runs.count, 2)
        for (index, run) in runs.enumerated() {
            XCTAssertEqual(run["importNumber"] as? Int, index + 1)
            let classification = try XCTUnwrap(run["classification"] as? [String: Any])
            XCTAssertEqual(classification["status"] as? String, "complete")
            let candidates = try XCTUnwrap(classification["candidates"] as? [[String: Any]])
            XCTAssertEqual(candidates.count, 3)
            XCTAssertTrue(candidates.allSatisfy { $0["status"] as? String == "classified" })
            let medical = candidates.filter { $0["classification"] as? String == "medical" && $0["uncertainty"] as? String == "low" }
            XCTAssertEqual(medical.count, 1)
            let selected = try XCTUnwrap(medical.first)
            XCTAssertEqual(selected["status"] as? String, "classified")
            XCTAssertEqual(selected["candidateId"] as? String, "calendar-candidate-1")
            XCTAssertEqual(run["saves"] as? [String], ["saved"])
            try verifySingleOccurrence(run["stored"])
        }
        try verifySingleOccurrence(result["stored"])
    }

    private func verifySingleOccurrence(_ value: Any?) throws {
        let stored = try XCTUnwrap(value as? [[String: Any]])
        XCTAssertEqual(stored.count, 1)
        let appointment = try XCTUnwrap(stored.first)
        XCTAssertEqual(appointment["id"] as? String, "synthetic-appointment-1")
        XCTAssertEqual(appointment["calendarEventIdentifier"] as? String, "synthetic-calendar-0")
        let snapshot = try XCTUnwrap(appointment["calendarEventSnapshot"] as? [String: Any])
        XCTAssertEqual(snapshot["title"] as? String, "내과 진료")
    }

    func testMockCalendarClassificationCitedQuestionsAndWorkflowCancellation() async throws {
        let result = try await TestOperationBroker.shared.request("apple-workflow")
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "mock-apple-workflow-synthetic-inputs"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        // The controlled mock must still drive complete classification, cited questions and cancellation.
        XCTAssertEqual(result["modelExecution"] as? String, "mock")
        XCTAssertEqual(result["actualModel"] as? String, "not-run")
        XCTAssertEqual(result["availability"] as? String, "available")
        let calendar = try XCTUnwrap(result["calendar"] as? [String: Any])
        XCTAssertEqual(calendar["status"] as? String, "complete")
        let nextVisit = try XCTUnwrap(result["nextVisit"] as? [String: Any])
        XCTAssertEqual(nextVisit["status"] as? String, "ready")
        let questions = try XCTUnwrap(nextVisit["questions"] as? [[String: Any]])
        XCTAssertFalse(questions.isEmpty)
        for question in questions {
            XCTAssertFalse(try XCTUnwrap(question["citations"] as? [[String: Any]]).isEmpty)
        }
        let cancellation = try XCTUnwrap(result["cancellation"] as? [String: Any])
        XCTAssertEqual(cancellation["providerStarted"] as? Bool, true)
        XCTAssertEqual(cancellation["abortSent"] as? Bool, true)
        let cancelled = try XCTUnwrap(cancellation["result"] as? [String: Any])
        XCTAssertEqual(cancelled["status"] as? String, "cancelled")
        // The bridge/workflow cancellation result does not prove immediate physical inference stopping.
        XCTAssertEqual(cancellation["inferenceStop"] as? String, "unverified")
    }
}
