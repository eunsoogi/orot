import Foundation
@testable import Orot
import XCTest

/// Exercises the actual native encoder and scheduling wrapper without authorizing or mutating the OS.
final class AppointmentReminderDiagnosticTests: OrotFailFastTestCase {
    func testSentinelNSErrorIsRedactedAndRethrownByIdentity() async throws {
        let sentinel = NSError(domain: "private-appointment-domain", code: 47, userInfo: [
            NSLocalizedDescriptionKey: "private-health-description", "appointmentId": "private-visit",
        ])
        var stages: [AppointmentReminderDiagnosticStage] = []
        var recorded: Error?
        do {
            try await AppointmentReminderDiagnosticTrace.aroundAdd(emit: { stage, error in
                stages.append(stage)
                recorded = error
            }, enabled: true) { throw sentinel }
            XCTFail("The original rejection must propagate")
        } catch {
            XCTAssertTrue(error as NSError === sentinel)
            XCTAssertTrue(recorded as NSError? === sentinel)
        }
        XCTAssertEqual(stages, [.centerAddEnter, .centerAddReject])
        let event = AppointmentReminderDiagnosticTrace.Event(
            runID: UUID().uuidString, processID: 1, callSequence: 1,
            monotonicNanoseconds: "1", stage: .centerAddReject, error: sentinel,
        )
        let bytes = try event.jsonLine()
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(value["errorDomain"] as? String, "other")
        XCTAssertEqual(value["errorCode"] as? Int, 47)
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("private-"))
        XCTAssertNil(value["userInfo"])
        XCTAssertNil(value["localizedDescription"])
    }
}
