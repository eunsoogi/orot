import XCTest

/// One real screen stop reaches Apple Speech and the production saved-draft view. A separate new-process test compares all fields.
final class AutomaticTranscriptionUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testScreenStopReachesSavedDraft() throws {
        let app = XCUIApplication()
        let arguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TEST_SCENARIO", "automatic-transcription"]
        app.launchArguments = arguments
        app.launch()
        defer { app.terminate() }
        // Preserve failed fixtures for diagnosis; the runner resets only its dedicated test container before a fresh suite.
        value(app, "automatic-transcription-phase", "ready")
        let refusal = try report(app, id: "automatic-transcription-refusal", name: "automatic-save-refusal")
        XCTAssertEqual(refusal["rejectionCode"] as? String, "RECORDING_FILE_PROTECTION_FAILED")
        XCTAssertEqual(refusal["absentSource"] as? Bool, true)
        XCTAssertEqual(refusal["absentSegments"] as? Bool, true)
        XCTAssertEqual(refusal["providerCalls"] as? Int, 0)
        XCTAssertNotEqual(refusal["fileProtection"] as? String, "complete")
        let fixtureID = try XCTUnwrap(refusal["fixtureId"] as? String)
        XCTAssertNotNil(UUID(uuidString: fixtureID))
        tap(app, "recording-consent")
        tap(app, "recording-microphone-control")
        let pause = UITestConditions.element(app, "recording-pause")
        XCTAssertTrue(pause.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(pause.label.isEmpty, pause.debugDescription)
        // Capture the production session while its icon pause control is available.
        let sessionScreenshot = XCTAttachment(screenshot: app.screenshot())
        sessionScreenshot.name = "recording-session-active"
        sessionScreenshot.lifetime = .keepAlways
        add(sessionScreenshot)
        tap(app, "recording-microphone-control")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "녹음 ID")).firstMatch.exists,
            app.debugDescription,
        )
        // This observes the completed screen-owned job; it never starts or retries recognition from the harness.
        value(app, "automatic-transcription-phase", "complete")
        let result = try report(app, id: "automatic-transcription-result", name: "automatic-saved-result")
        XCTAssertEqual(result["providerCalls"] as? Int, 1)
        XCTAssertEqual(result["events"] as? [String], [
            "production-save-refused", "screen-start", "screen-stop", "synthetic-source-saved",
            "speech-provider-start", "speech-provider-complete",
        ])
        XCTAssertEqual(result["fileProtection"] as? String, refusal["fileProtection"] as? String)
        let source = try dictionary(result, "source")
        let sourceID = try XCTUnwrap(source["id"] as? String)
        XCTAssertEqual(sourceID, fixtureID)
        let segments = try XCTUnwrap(result["segments"] as? [[String: Any]])
        let firstText = try XCTUnwrap(segments.first?["text"] as? String)
        XCTAssertFalse(firstText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        let native = try dictionary(result, "nativeObservation")
        XCTAssertEqual(native["speechRequests"] as? Int, 1)
        // Select this exact saved source and inspect the shipping transcript view, not the diagnostic JSON alone.
        tap(app, "recording-details-\(sourceID)")
        XCTAssertTrue(UITestConditions.element(app, "recording-detail").waitForAppearance())
        let transcript = UITestConditions.element(app, "transcript-text-0")
        FormUITestConditions.reveal(transcript, in: app, scrollID: "recording-controls-scroll")
        UITestConditions.value(transcript, equals: firstText)
        UITestConditions.value(UITestConditions.element(app, "transcript-review-0"), equals: "검토 전 초안")
        // Preserve this source for the host-orchestrated new-process readback and its exact-scope cleanup.
    }

    @MainActor
    func testActiveTranscriptionSurvivesDuoReflow() throws {
        // Only capture and source linking are synthetic; the screen-owned operation uses Apple Speech and the saved-draft UI.
        let originalOrientation = XCUIDevice.shared.orientation
        let app = XCUIApplication()
        defer {
            XCUIDevice.shared.orientation = originalOrientation
            app.terminate()
        }
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "duo",
            "-OROT_TEST_SCENARIO", "automatic-transcription",
        ]
        app.launch()
        waitForPhase(app, "ready")
        let refusal = try report(app, id: "automatic-transcription-refusal", name: "duo-automatic-save-refusal")
        XCTAssertEqual(refusal["providerCalls"] as? Int, 0)
        let fixtureID = try XCTUnwrap(refusal["fixtureId"] as? String)

        tap(app, "recording-consent")
        tap(app, "recording-microphone-control")
        let pause = UITestConditions.element(app, "recording-pause")
        XCTAssertTrue(pause.waitForAppearance(), app.debugDescription)
        tap(app, "recording-microphone-control")
        waitForPhase(app, "running")

        let recordingWidth = app.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > frame.height && abs(frame.width - recordingWidth) > 0.5
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [landscape]), .completed, app.debugDescription)
        waitForPhase(app, "complete")

        let result = try report(app, id: "automatic-transcription-result", name: "duo-automatic-saved-result")
        XCTAssertEqual(result["providerCalls"] as? Int, 1)
        XCTAssertEqual(result["events"] as? [String], [
            "production-save-refused", "screen-start", "screen-stop", "synthetic-source-saved",
            "speech-provider-start", "speech-provider-complete",
        ])
        XCTAssertEqual(result["fileProtection"] as? String, refusal["fileProtection"] as? String)
        let source = try dictionary(result, "source")
        let sourceID = try XCTUnwrap(source["id"] as? String)
        XCTAssertEqual(sourceID, fixtureID)
        let segments = try XCTUnwrap(result["segments"] as? [[String: Any]])
        let transcriptText = try XCTUnwrap(segments.first?["text"] as? String)
        XCTAssertFalse(transcriptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        XCTAssertEqual(try dictionary(result, "nativeObservation")["speechRequests"] as? Int, 1)

        tap(app, "recording-details-\(sourceID)")
        XCTAssertTrue(UITestConditions.element(app, "recording-detail").waitForAppearance())
        let transcript = UITestConditions.element(app, "transcript-text-0")
        FormUITestConditions.reveal(transcript, in: app, scrollID: "recording-controls-scroll")
        UITestConditions.value(transcript, equals: transcriptText)
        UITestConditions.value(UITestConditions.element(app, "transcript-review-0"), equals: "검토 전 초안")
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = UITestConditions.element(app, id)
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "recording-controls-scroll")
        target.tap()
    }

    @MainActor
    private func value(_ app: XCUIApplication, _ id: String, _ expected: String) {
        UITestConditions.value(UITestConditions.element(app, id), equals: expected)
    }

    @MainActor
    private func waitForPhase(_ app: XCUIApplication, _ expected: String) {
        let phase = UITestConditions.element(app, "automatic-transcription-phase")
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            UITestConditions.text(phase) == expected
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed, app.debugDescription)
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
}
