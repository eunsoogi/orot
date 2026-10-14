import XCTest

final class SpeechJourneyUITests: OrotFailFastTestCase {
    @MainActor
    func testTranscriptionReachesSavedRecordingAndSurvivesRelaunch() throws {
        let app = XCUIApplication()
        let arguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "speech-journey"]
        app.launchArguments = arguments
        app.launch()
        let status = UITestConditions.element(app, "speech-journey-status")
        UITestConditions.value(status, equals: "ready")
        UITestConditions.element(app, "speech-journey-start").tap()
        // Recognition has the unchanged native 120-second deadline; this UI wait only observes its saved result.
        UITestConditions.value(status, equals: "saved", timeout: 150)
        let resultElement = UITestConditions.element(app, "speech-journey-result")
        let bytes = try XCTUnwrap(UITestConditions.text(resultElement).data(using: .utf8))
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let sourceId = try XCTUnwrap(result["sourceId"] as? String)
        XCTAssertNotNil(UUID(uuidString: sourceId))
        let text = try XCTUnwrap(result["text"] as? String)
        XCTAssertFalse(text.isEmpty)
        XCTAssertGreaterThan(try XCTUnwrap(result["segmentCount"] as? Int), 0)
        XCTAssertTrue(try ["speech_transcriber", "dictation_transcriber", "on_device_speech_recognizer"].contains(
            XCTUnwrap(result["engine"] as? String),
        ))
        let firstSegmentText = try XCTUnwrap(result["firstSegmentText"] as? String)
        verifyProductionTranscript(app, sourceId: sourceId, text: firstSegmentText)
        let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: "public.json")
        attachment.name = "speech-to-app-saved-transcript"
        attachment.lifetime = .keepAlways
        add(attachment)

        app.terminate()
        app.launchArguments = arguments + ["-OROT_TEST_RECORDING_ID", sourceId]
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "speech-journey-status"), equals: "restored")
        let restored = UITestConditions.text(UITestConditions.element(app, "speech-journey-result"))
        XCTAssertEqual(restored, String(decoding: bytes, as: UTF8.self))
        verifyProductionTranscript(app, sourceId: sourceId, text: firstSegmentText)
        let cleanup = UITestConditions.element(app, "speech-journey-cleanup")
        UITestConditions.scrollTo(cleanup, in: app)
        cleanup.tap()
        UITestConditions.value(UITestConditions.element(app, "speech-journey-status"), equals: "cleaned")
        app.terminate()
    }

    @MainActor
    private func verifyProductionTranscript(_ app: XCUIApplication, sourceId: String, text: String) {
        // Select the newly created source, never another run's same-titled synthetic recording.
        let row = UITestConditions.element(app, "recording-details-\(sourceId)")
        UITestConditions.scrollTo(row, in: app)
        row.tap()
        XCTAssertTrue(UITestConditions.element(app, "recording-detail").waitForExistence(timeout: 30))
        let transcript = UITestConditions.element(app, "transcript-text-0")
        UITestConditions.scrollTo(transcript, in: app)
        UITestConditions.value(transcript, equals: text)
        UITestConditions.value(UITestConditions.element(app, "transcript-review-0"), equals: "검토 전 초안")
    }
}
