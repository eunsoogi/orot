import Foundation
@testable import Orot
import XCTest

final class AppleModelIntegrationTests: XCTestCase {
    func testAvailabilityAndSupportedGenerationKeepRuntimeLimitationsExplicit() async throws {
        // Availability comes from the actual Apple SDK. Unsupported hardware cannot prove generation or inference stopping.
        let result = try await TestOperationBroker.shared.request("apple-model", timeout: 240)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["inferenceStop"] as? String, "unverified")
        let availability = try XCTUnwrap(result["availability"] as? String)
        XCTAssertTrue(["available", "disabled", "modelNotReady", "unsupportedDevice", "unsupportedLanguage"].contains(availability))
        if availability == "available" {
            XCTAssertEqual(result["generation"] as? String, "passed")
            XCTAssertEqual(result["sourceIdPreserved"] as? String, "passed")
            let question = try XCTUnwrap(result["questionText"] as? String)
            XCTAssertFalse(question.isEmpty)
            XCTAssertNotEqual(question, "not-run")
            XCTAssertTrue(try ["cancelled", "completed-before-cancel"].contains(XCTUnwrap(result["cancellation"] as? String)))
        } else {
            for field in ["generation", "sourceIdPreserved", "questionText", "cancellation"] {
                XCTAssertEqual(result[field] as? String, "not-run", field)
            }
        }
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "apple-model-actual-availability"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
