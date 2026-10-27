import Foundation
@testable import Orot
import React
import XCTest

/// Exercises the actual native encoder and scheduling wrapper without authorizing or mutating the OS.
final class AppointmentReminderDiagnosticTests: OrotFailFastTestCase {
    /// RN's actual serializer must carry only the safe origin and keep normalized public errors.
    func testOriginCarrierSurvivesActualRNSerializationWithoutOriginalNSError() throws {
        let runID = UUID().uuidString.lowercased()
        let carrier = AppointmentReminderFailureOrigin.carrier(runID: runID, sequence: 17)
        let serialized = RCTJSErrorFromCodeMessageAndNSError(
            "REMINDER_SCHEDULE_FAILED", "The local reminder could not be updated.", carrier,
        )
        XCTAssertEqual(serialized["code"] as? String, "REMINDER_SCHEDULE_FAILED")
        XCTAssertEqual(serialized["message"] as? String, "The local reminder could not be updated.")
        let info = try XCTUnwrap(serialized["userInfo"] as? [String: Any])
        XCTAssertEqual(Set(info.keys), ["orotReminderOrigin"])
        let origin = try XCTUnwrap(info["orotReminderOrigin"] as? [String: Any])
        XCTAssertEqual(Set(origin.keys), ["runID", "operationSequence"])
        XCTAssertEqual(origin["runID"] as? String, runID)
        XCTAssertEqual(origin["operationSequence"] as? Int, 17)
        XCTAssertNil(carrier.userInfo[NSUnderlyingErrorKey])
        XCTAssertNil(carrier.userInfo[NSLocalizedDescriptionKey])
        // Native XCTest has no diagnostic launch opt-in; ordinary rejection stays nil.
        XCTAssertNil(appointmentReminderFailureOriginCarrier())
    }

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
