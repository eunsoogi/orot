import Foundation
@testable import Orot
import XCTest

/// Uses the actual Apple provider with synthetic source/context boundaries; unavailable models cannot satisfy this workflow requirement.
final class AppleWorkflowIntegrationTests: XCTestCase {
    func testActualCalendarClassificationCitedQuestionsAndWorkflowCancellation() async throws {
        let result = try await TestOperationBroker.shared.request("apple-workflow", timeout: 300)
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "actual-apple-workflow-synthetic-inputs"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        // Keep the former available-only acceptance: recording an unsupported status is not a successful classification or generation.
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
