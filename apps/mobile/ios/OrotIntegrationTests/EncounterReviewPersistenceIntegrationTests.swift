import Foundation
@testable import Orot
import XCTest

/// The canonical driver invokes these phases in three host processes against one owned encrypted fixture.
final class EncounterReviewPersistenceIntegrationTests: OrotFailFastTestCase {
    func testPendingReviewWaitsForApproval() async throws {
        let result = try await phase("seed")
        XCTAssertEqual(result["status"] as? String, "pending")
        XCTAssertEqual(result["recordCount"] as? Int, 0)
        XCTAssertEqual(result["modelCalls"] as? Int, 1)
        let diagnostic = try XCTUnwrap(result["diagnostic"] as? [String: Any])
        XCTAssertEqual(diagnostic["status"] as? String, result["status"] as? String)
        XCTAssertEqual(diagnostic["recordCount"] as? Int, 0)
        XCTAssertEqual(diagnostic["modelCalls"] as? Int, 1)
        let pending = try XCTUnwrap(result["pending"] as? [String: Any])
        try verifyPending(pending)
    }

    func testPendingReviewRestoresInNewProcessWithoutExtraction() async throws {
        try requireNewProcess()
        let result = try await phase("resume")
        XCTAssertEqual(result["status"] as? String, "saved")
        XCTAssertEqual(result["recordCount"] as? Int, 2)
        XCTAssertEqual(result["modelCalls"] as? Int, 0)
        let pending = try XCTUnwrap(result["restored"] as? [String: Any])
        try verifyPending(pending)
    }

    func testApprovedReviewReadbackInThirdProcess() async throws {
        try requireNewProcess()
        let result = try await phase("readback")
        XCTAssertEqual(result["status"] as? String, "saved")
        XCTAssertEqual(result["modelCalls"] as? Int, 0)
        XCTAssertEqual(result["cleanupVerified"] as? Bool, true)
        let records = try XCTUnwrap(result["records"] as? [[String: Any]])
        XCTAssertEqual(records.count, 2)
        XCTAssertEqual(Set(records.compactMap { $0["concept"] as? String }), ["encounter_medication_statement", "encounter_plan"])
        for record in records {
            XCTAssertEqual((record["reviewState"] as? [String: Any])?["status"] as? String, "reviewed")
            let provenance = try XCTUnwrap(record["provenance"] as? [String: Any])
            XCTAssertEqual(provenance["origin"] as? String, "derived")
            XCTAssertEqual((provenance["source"] as? [String: Any])?["sourceName"] as? String, "speaker:unknown")
        }
        let evidence = try XCTUnwrap(result["evidence"] as? [[String: Any]])
        XCTAssertEqual(evidence.count, 4)
        XCTAssertEqual(evidence.compactMap { ($0["locator"] as? [String: Any])?["kind"] as? String }.filter { $0 == "text_range" }.count, 2)
        XCTAssertEqual(evidence.compactMap { ($0["locator"] as? [String: Any])?["kind"] as? String }.filter { $0 == "audio_time_range" }.count, 2)
    }

    private func verifyPending(_ pending: [String: Any]) throws {
        let source = try fixture() + ":review"
        XCTAssertEqual(pending["sourceId"] as? String, source)
        XCTAssertTrue(try XCTUnwrap(pending["threadId"] as? String).hasPrefix("encounter-review-session:"))
        let candidates = try XCTUnwrap(pending["candidates"] as? [[String: Any]])
        XCTAssertEqual(candidates.count, 2)
        XCTAssertTrue(candidates.allSatisfy { $0["speaker"] as? String == "unknown" })
        let segments = try XCTUnwrap(pending["segments"] as? [[String: Any]])
        XCTAssertEqual(segments.first?["revision"] as? Int, 1)
        XCTAssertEqual(segments.first?["id"] as? String, source + ":segment:r1")
        let range = try XCTUnwrap(segments.first?["audioRange"] as? [String: Int])
        XCTAssertEqual(range, ["startMs": 100, "endMs": 2900])
        let evidence = try XCTUnwrap(candidates.first?["evidence"] as? [[String: Any]])
        XCTAssertEqual(evidence.first?["segmentId"] as? String, source + ":segment:r1")
        XCTAssertEqual(evidence.first?["quote"] as? String, "합성약 5 mg을 논의했어요.")
        XCTAssertEqual(evidence.first?["startOffset"] as? Int, 0)
        XCTAssertEqual(evidence.first?["endOffset"] as? Int, 16)
    }

    private func phase(_ mode: String) async throws -> [String: Any] {
        let result: [String: Any]
        do {
            result = try await TestOperationBroker.shared.request("encounter-review-persistence", parameters: ["mode": mode, "fixtureIdentifier": fixture()])
        } catch let TestOperationBroker.Failure.javascript(message) {
            // Only the fixture's sanitized JSON suffix is retained; never attach a raw broker error.
            if let marker = message.range(of: "EncounterReviewDiagnostic "),
               let data = String(message[marker.upperBound...]).data(using: .utf8),
               let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            {
                let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: snapshot), uniformTypeIdentifier: "public.json")
                attachment.name = "encounter-review-\(mode)-diagnostic"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
            throw TestOperationBroker.Failure.javascript(message)
        }
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        var receipt = result
        receipt["fixtureIdentifier"] = try fixture()
        receipt["runId"] = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_ENCOUNTER_REVIEW_RUN_ID"])
        receipt["phase"] = mode
        receipt["processIdentifier"] = Int(ProcessInfo.processInfo.processIdentifier)
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "encounter-review-\(mode)"
        attachment.lifetime = .keepAlways
        add(attachment)
        return receipt
    }

    private func fixture() throws -> String {
        let value = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_ENCOUNTER_REVIEW_FIXTURE"])
        XCTAssertTrue(value.hasPrefix("test-persistence-"))
        XCTAssertNotNil(UUID(uuidString: String(value.dropFirst("test-persistence-".count))))
        return value
    }

    private func requireNewProcess() throws {
        let json = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_ENCOUNTER_REVIEW_PREVIOUS_PIDS"])
        let previous = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [Int])
        XCTAssertFalse(previous.isEmpty)
        XCTAssertFalse(previous.contains(Int(ProcessInfo.processInfo.processIdentifier)))
    }
}
