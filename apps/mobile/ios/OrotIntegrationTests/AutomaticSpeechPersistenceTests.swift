import Foundation
@testable import Orot
import XCTest

/// Consumes the preceding UI invocation's exact attachment in a new app host, with no accessibility session.
final class AutomaticSpeechPersistenceTests: OrotFailFastTestCase {
    func testSavedSpeechFieldsSurviveNewProcessWithoutRecognition() async throws {
        let text = try XCTUnwrap(ProcessInfo.processInfo.environment["OROT_SPEECH_BASELINE"])
        let expected = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let previous = try dictionary(expected, "nativeObservation")
        let before = TestSpeechObservation.snapshot()
        XCTAssertNotEqual(before["processIdentifier"] as? Int, previous["processIdentifier"] as? Int)
        XCTAssertNotEqual(before["processInstance"] as? String, previous["processInstance"] as? String)
        XCTAssertEqual(before["speechRequests"] as? Int, 0)
        XCTAssertEqual(previous["speechRequests"] as? Int, 1)
        try verifyOriginalFields(expected)
        let source = try dictionary(expected, "source")
        let sourceID = try XCTUnwrap(source["id"] as? String)
        let restored = try await TestOperationBroker.shared.request("automatic-speech-readback", parameters: ["sourceId": sourceID])
        XCTAssertEqual(restored["platform"] as? String, "ios")
        XCTAssertEqual(restored["runtime"] as? String, "Hermes")
        XCTAssertEqual(try dictionary(restored, "source") as NSDictionary, source as NSDictionary)
        let segments = try XCTUnwrap(expected["segments"] as? NSArray)
        XCTAssertEqual(try XCTUnwrap(restored["segments"] as? NSArray), segments)
        let loaded = try dictionary(restored, "loaded")
        XCTAssertEqual(try dictionary(loaded, "source") as NSDictionary, source as NSDictionary)
        XCTAssertEqual(try XCTUnwrap(loaded["segments"] as? NSArray), segments)
        XCTAssertEqual(try XCTUnwrap(restored["reused"] as? NSArray), segments)
        let after = TestSpeechObservation.snapshot()
        XCTAssertEqual(after["speechRequests"] as? Int, 0)
        let receipt: [String: Any] = ["nativeObservation": after, "sourceId": sourceID,
                                      "previousNativeObservation": previous, "restored": restored]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "automatic-persisted-relaunch"
        attachment.lifetime = .keepAlways
        add(attachment)
        let cleanup = try await TestOperationBroker.shared.request("automatic-speech-cleanup", parameters: ["sourceId": sourceID])
        XCTAssertEqual(cleanup["cleaned"] as? Bool, true)
    }

    /// Preserve the original independent native-seconds versus stored-milliseconds, provenance and draft assertions.
    private func verifyOriginalFields(_ result: [String: Any]) throws {
        let refusal = try dictionary(result, "refusal")
        XCTAssertEqual(refusal["rejectionCode"] as? String, "RECORDING_FILE_PROTECTION_FAILED")
        XCTAssertEqual(refusal["absentSource"] as? Bool, true)
        XCTAssertEqual(refusal["absentSegments"] as? Bool, true)
        XCTAssertEqual(refusal["providerCalls"] as? Int, 0)
        XCTAssertNotEqual(refusal["fileProtection"] as? String, "complete")
        XCTAssertEqual(result["fileProtection"] as? String, refusal["fileProtection"] as? String)
        XCTAssertEqual(result["providerCalls"] as? Int, 1)
        XCTAssertEqual(result["events"] as? [String], [
            "production-save-refused", "screen-start", "screen-stop", "synthetic-source-saved",
            "speech-provider-start", "speech-provider-complete",
        ])
        let source = try dictionary(result, "source")
        let sourceID = try XCTUnwrap(source["id"] as? String)
        XCTAssertNotNil(UUID(uuidString: sourceID))
        XCTAssertEqual(sourceID, refusal["fixtureId"] as? String)
        let serviceResult = try dictionary(result, "speechResult")
        let engine = try XCTUnwrap(serviceResult["engine"] as? String)
        XCTAssertTrue(["speech_transcriber", "dictation_transcriber", "on_device_speech_recognizer"].contains(engine))
        let speechSegments = try XCTUnwrap(serviceResult["segments"] as? [[String: Any]])
        let segments = try XCTUnwrap(result["segments"] as? [[String: Any]])
        XCTAssertFalse(speechSegments.isEmpty)
        XCTAssertEqual(segments.count, speechSegments.count)
        for (index, segment) in segments.enumerated() {
            let speechSegment = speechSegments[index]
            let text = try XCTUnwrap(segment["text"] as? String)
            XCTAssertEqual(text, speechSegment["text"] as? String)
            XCTAssertFalse(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            let range = try dictionary(segment, "audioRange")
            XCTAssertEqual(try number(range, "startMs"), try floor(number(speechSegment, "startSeconds") * 1000))
            XCTAssertEqual(try number(range, "endMs"), try ceil(number(speechSegment, "endSeconds") * 1000))
            XCTAssertLessThanOrEqual(try number(range, "endMs"), try number(segment, "recordingDurationMs"))
            XCTAssertEqual(segment["recordingSourceId"] as? String, sourceID)
            XCTAssertEqual(try dictionary(segment, "reviewState")["status"] as? String, "unreviewed")
            let provenance = try dictionary(dictionary(segment, "provenance"), "source")
            XCTAssertEqual(provenance["system"] as? String, "Apple Speech")
            XCTAssertEqual(provenance["sourceIdentifier"] as? String, engine)
        }
    }

    private func dictionary(_ value: [String: Any], _ key: String) throws -> [String: Any] {
        try XCTUnwrap(value[key] as? [String: Any])
    }

    private func number(_ value: [String: Any], _ key: String) throws -> Double {
        try XCTUnwrap(value[key] as? NSNumber).doubleValue
    }
}
