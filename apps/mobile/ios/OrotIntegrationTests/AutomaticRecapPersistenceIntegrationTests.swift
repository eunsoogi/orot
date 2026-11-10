import Foundation
@testable import Orot
import XCTest

/// The host must run the seed and readback in distinct app processes with one isolated fixture container.
final class AutomaticRecapPersistenceIntegrationTests: OrotFailFastTestCase {
    func testSyntheticTranscriptionAutomaticallySavesOfficialRecap() async throws {
        let receipt = try await TestOperationBroker.shared.request("automatic-recap-seed")
        XCTAssertEqual(receipt["platform"] as? String, "ios")
        XCTAssertEqual(receipt["runtime"] as? String, "Hermes")
        XCTAssertEqual(receipt["speechCalls"] as? Int, 1)
        XCTAssertEqual(receipt["modelCalls"] as? Int, 1)
        XCTAssertEqual(receipt["recognition"] as? String, "synthetic")
        XCTAssertEqual(receipt["model"] as? String, "synthetic")
        let source = try XCTUnwrap(receipt["sourceId"] as? String)
        XCTAssertNotNil(UUID(uuidString: source))
        let result = try XCTUnwrap(receipt["result"] as? [String: Any])
        XCTAssertEqual(result["recordingSourceId"] as? String, source)
        let questions = try XCTUnwrap(result["questions"] as? [[String: Any]])
        XCTAssertEqual(questions.count, 1)
        XCTAssertEqual(questions.first?["status"] as? String, "evidence_found")
        let answers = try XCTUnwrap(questions.first?["answers"] as? [[String: Any]])
        XCTAssertEqual(answers.count, 1)
        XCTAssertEqual(answers.first?["quotation"] as? String, "네, 지금 용량을 유지하세요.")
        XCTAssertEqual(answers.first?["speaker"] as? String, "unknown")
        let evidence = try XCTUnwrap(answers.first?["evidence"] as? [[String: Any]])
        XCTAssertEqual(evidence.first?["quote"] as? String, "네, 지금 용량을 유지하세요.")
        let range = try XCTUnwrap(evidence.first?["audioRange"] as? [String: Int])
        XCTAssertEqual(range, ["startMs": 250, "endMs": 1800])
        let records = try XCTUnwrap(receipt["records"] as? [[String: Any]])
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.first?["sourceMethod"] as? String, "ai_generated")
        XCTAssertEqual(records.first?["editOrigin"] as? String, "ai_analysis")
        var baseline = receipt
        baseline["processIdentifier"] = Int(ProcessInfo.processInfo.processIdentifier)
        try attach(baseline, name: "automatic-recap-seed")
    }

    func testOfficialRecapReadbackMatchesAfterNewProcess() async throws {
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_AUTOMATIC_RECAP_BASELINE"])
        let baseline = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let previousPID = try XCTUnwrap(baseline["processIdentifier"] as? Int)
        XCTAssertNotEqual(previousPID, Int(ProcessInfo.processInfo.processIdentifier))
        let source = try XCTUnwrap(baseline["sourceId"] as? String)
        XCTAssertNotNil(UUID(uuidString: source))
        let receipt = try await TestOperationBroker.shared.request("automatic-recap-read", parameters: ["sourceId": source])
        XCTAssertEqual(receipt["platform"] as? String, "ios")
        XCTAssertEqual(receipt["runtime"] as? String, "Hermes")
        XCTAssertEqual(receipt["sourceId"] as? String, source)
        XCTAssertEqual(try XCTUnwrap(receipt["result"] as? NSDictionary), try XCTUnwrap(baseline["result"] as? NSDictionary))
        XCTAssertEqual(try XCTUnwrap(receipt["records"] as? NSArray), try XCTUnwrap(baseline["records"] as? NSArray))
        try attach(receipt, name: "automatic-recap-reopened")
        let cleanup = try await TestOperationBroker.shared.request("automatic-recap-cleanup", parameters: ["sourceId": source])
        XCTAssertEqual(cleanup["cleaned"] as? Bool, true)
        XCTAssertEqual(cleanup["sourceId"] as? String, source)
    }

    private func attach(_ receipt: [String: Any], name: String) throws {
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
