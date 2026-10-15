import Foundation
@testable import Orot
import XCTest

/// The host runs these phases separately. SQL and export residue must cross an actual process boundary without an AX session.
final class RecordingPersistenceIntegrationTests: OrotFailFastTestCase {
    func testSeedCorrectionDeletionAndInterruptedExport() async throws {
        let result = try await operation("recording-persistence-seed")
        XCTAssertEqual(result["memoryInvalidation"] as? String, "passed")
        XCTAssertEqual(result["deletionCommitted"] as? Bool, true)
        XCTAssertEqual(result["syntheticRecognition"] as? Bool, true)
        // Exercise the actual module's presentation, dismissal, Promise and cleanup, not just its one-shot flag.
        try await cancelTranscriptExport()
        XCTAssertEqual(RecordingExportFiles.residueCount(), 0)
        try RecordingExportFiles.prepareSyntheticResidue()
        XCTAssertEqual(RecordingExportFiles.residueCount(), 1)
        try attach(result, name: "recording-persistence-seeded")
    }

    func testReadCorrectionDeletionAndCleanInterruptedExportInNewProcess() async throws {
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_RECORDING_BASELINE"])
        let baseline = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        XCTAssertNotEqual(baseline["processIdentifier"] as? Int, Int(ProcessInfo.processInfo.processIdentifier))
        let expected = try XCTUnwrap(baseline["result"] as? [String: Any])
        let result = try await operation("recording-persistence-read", parameters: expected)
        XCTAssertEqual(try XCTUnwrap(result["retained"] as? NSDictionary), try XCTUnwrap(expected["retained"] as? NSDictionary))
        XCTAssertEqual(result["deletedSourceId"] as? String, expected["deletedSourceId"] as? String)
        XCTAssertEqual(result["deletionAbsent"] as? Bool, true)
        XCTAssertEqual(result["retainedCleaned"] as? Bool, true)
        XCTAssertEqual(RecordingExportFiles.residueCount(), 1)
        // The first export in this process must sweep the interrupted copy, then clean its own cancelled copy.
        try await cancelTranscriptExport()
        XCTAssertEqual(RecordingExportFiles.residueCount(), 0)
        try attach(result, name: "recording-persistence-restored")
    }

    @MainActor
    private func cancelTranscriptExport() async throws {
        let module = RecordingModule()
        RecordingExportFiles.armCancellation()
        let completion = expectation(description: "Actual share presentation and synthetic cancellation complete")
        var result: String?
        module.shareRecordingTranscript("합성 전사 café🙂\n", resolver: { value in
            result = value as? String
            completion.fulfill()
        }, rejecter: { code, message, _ in
            XCTFail("Export failed: \(code ?? "unknown") \(message ?? "")")
            completion.fulfill()
        })
        await fulfillment(of: [completion], timeout: 30)
        XCTAssertEqual(result, "cancelled")
        XCTAssertFalse(RecordingExportFiles.consumeSimulatorCancellation())
    }

    private func operation(_ name: String, parameters: [String: Any] = [:]) async throws -> [String: Any] {
        let result = try await TestOperationBroker.shared.request(name, parameters: parameters)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        return result
    }

    private func attach(_ result: [String: Any], name: String) throws {
        let receipt: [String: Any] = ["result": result, "processIdentifier": ProcessInfo.processInfo.processIdentifier]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
