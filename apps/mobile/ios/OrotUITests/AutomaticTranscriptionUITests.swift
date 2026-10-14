import XCTest

/// Uses the production screen's stop action and real Apple Speech, then compares every persisted field after process restart.
final class AutomaticTranscriptionUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testScreenStopPersistsSpeechSegmentsAndReopensWithoutRecognition() throws {
        let app = XCUIApplication()
        let arguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TEST_SCENARIO", "automatic-transcription"]
        app.launchArguments = arguments
        app.launch()
        defer { app.terminate() }
        // Preserve failed fixtures for diagnosis; the runner resets only its dedicated test container before a fresh suite.
        value(app, "automatic-transcription-phase", "ready", timeout: 60)
        let refusal = try report(app, id: "automatic-transcription-refusal", name: "automatic-save-refusal")
        XCTAssertEqual(refusal["rejectionCode"] as? String, "RECORDING_FILE_PROTECTION_FAILED")
        XCTAssertEqual(refusal["absentSource"] as? Bool, true)
        XCTAssertEqual(refusal["absentSegments"] as? Bool, true)
        XCTAssertEqual(refusal["providerCalls"] as? Int, 0)
        XCTAssertNotEqual(refusal["fileProtection"] as? String, "complete")
        let fixtureID = try XCTUnwrap(refusal["fixtureId"] as? String)
        XCTAssertNotNil(UUID(uuidString: fixtureID))
        tap(app, "recording-consent")
        tap(app, "recording-start")
        tap(app, "recording-stop")
        // This observes the completed screen-owned job; it never starts or retries recognition from the harness.
        value(app, "automatic-transcription-phase", "complete", timeout: 150)
        let result = try report(app, id: "automatic-transcription-result", name: "automatic-saved-result")
        XCTAssertEqual(result["providerCalls"] as? Int, 1)
        XCTAssertEqual(result["events"] as? [String], [
            "production-save-refused", "screen-start", "screen-stop", "synthetic-source-saved",
            "native-provider-start", "native-provider-complete",
        ])
        XCTAssertEqual(result["fileProtection"] as? String, refusal["fileProtection"] as? String)
        let source = try dictionary(result, "source")
        let sourceID = try XCTUnwrap(source["id"] as? String)
        XCTAssertEqual(sourceID, fixtureID)
        let serviceResult = try dictionary(result, "nativeResult")
        let speechSegments = try XCTUnwrap(serviceResult["segments"] as? [[String: Any]])
        let segments = try XCTUnwrap(result["segments"] as? [[String: Any]])
        XCTAssertFalse(speechSegments.isEmpty)
        XCTAssertEqual(segments.count, speechSegments.count)
        for (index, segment) in segments.enumerated() {
            let native = speechSegments[index]
            let text = try XCTUnwrap(segment["text"] as? String)
            XCTAssertEqual(text, native["text"] as? String)
            XCTAssertFalse(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            let range = try dictionary(segment, "audioRange")
            let start = try number(range, "startMs")
            let end = try number(range, "endMs")
            XCTAssertEqual(start, try floor(number(native, "startSeconds") * 1000))
            XCTAssertEqual(end, try ceil(number(native, "endSeconds") * 1000))
            XCTAssertLessThanOrEqual(end, try number(segment, "recordingDurationMs"))
            XCTAssertEqual(segment["recordingSourceId"] as? String, sourceID)
            XCTAssertEqual(try dictionary(segment, "reviewState")["status"] as? String, "unreviewed")
            let provenance = try dictionary(dictionary(segment, "provenance"), "source")
            XCTAssertEqual(provenance["system"] as? String, "Apple Speech")
            XCTAssertEqual(provenance["sourceIdentifier"] as? String, serviceResult["engine"] as? String)
        }
        app.terminate()
        app.launchArguments = arguments + ["-OROT_AUTOMATIC_VERIFY_SOURCE_ID", sourceID]
        app.launch()
        value(app, "automatic-transcription-phase", "relaunch-complete", timeout: 60)
        let restored = try report(app, id: "automatic-transcription-result", name: "automatic-persisted-relaunch")
        XCTAssertEqual(restored["providerCalls"] as? Int, 0)
        XCTAssertEqual(try dictionary(restored, "source") as NSDictionary, source as NSDictionary)
        XCTAssertEqual(try XCTUnwrap(restored["segments"] as? NSArray), segments as NSArray)
        let cleanup = UITestConditions.element(app, "automatic-transcription-cleanup")
        XCTAssertTrue(UITestConditions.exists(cleanup))
        XCTAssertTrue(cleanup.isEnabled)
        cleanup.tap()
        value(app, "automatic-transcription-phase", "cleaned")
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = UITestConditions.element(app, id)
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "recording-controls-scroll")
        target.tap()
    }

    @MainActor
    private func value(_ app: XCUIApplication, _ id: String, _ expected: String, timeout: TimeInterval = 30) {
        UITestConditions.value(UITestConditions.element(app, id), equals: expected, timeout: timeout)
    }

    @MainActor
    private func report(_ app: XCUIApplication, id: String, name: String) throws -> [String: Any] {
        let element = UITestConditions.element(app, id)
        XCTAssertTrue(UITestConditions.exists(element))
        let data = try XCTUnwrap(UITestConditions.text(element).data(using: .utf8))
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func dictionary(_ value: [String: Any], _ key: String) throws -> [String: Any] {
        try XCTUnwrap(value[key] as? [String: Any])
    }

    private func number(_ value: [String: Any], _ key: String) throws -> Double {
        try XCTUnwrap(value[key] as? NSNumber).doubleValue
    }
}
