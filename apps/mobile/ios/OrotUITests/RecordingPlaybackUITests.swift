import XCTest

/// Drives the real native player with disposable audio; simulated route loss stays distinct from a physical audio-device change.
final class RecordingPlaybackUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSavedAudioPlaybackStopsCompletesAndReopensBeforeMissingFileRecovery() throws {
        let app = XCUIApplication()
        RecordingFixtureUITestConditions.launch(app, playback: "seed", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"] + AppearanceUITestConditions.observationArguments)
        var appearance: AppearanceUITestConditions.Snapshot?
        defer { restore(appearance, app: app) }
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        let row = try RecordingFixtureUITestConditions.select(app, testCase: self)
        row.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-detail"), timeout: 5))
        let play = reveal(app, "recording-playback-button")
        play.tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["녹음 재생 중…"], timeout: 5))
        progress(app)
        let stop = app.buttons["recording-playback-stop"]
        XCTAssertTrue(UITestConditions.exists(stop, timeout: 2))
        XCTAssertTrue(stop.isHittable)
        stop.tap()
        absent(stop, timeout: 5)
        play.tap()
        progress(app)
        absent(stop, timeout: 10)
        // Resume never reseeds audio or metadata, so this restart exercises the actual saved file.
        app.terminate()
        RecordingFixtureUITestConditions.launch(app, playback: "resume", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"] + AppearanceUITestConditions.observationArguments)
        let restored = savedRow(app)
        restored.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-detail"), timeout: 5))
        reveal(app, "recording-playback-button").tap()
        progress(app)
        absent(node(app, "recording-playback-stop"), timeout: 10)
        XCTAssertTrue(node(app, "recording-detail-duration").exists)
        app.terminate()
        RecordingFixtureUITestConditions.launch(app, playback: "missing", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"] + AppearanceUITestConditions.observationArguments)
        let retained = savedRow(app)
        retained.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-detail-duration")))
        reveal(app, "recording-playback-button").tap()
        let error = node(app, "recording-playback-error")
        XCTAssertTrue(UITestConditions.exists(error, timeout: 5))
        XCTAssertTrue(UITestConditions.text(error).contains("백업"))
        XCTAssertTrue(retained.exists)
        XCTAssertTrue(node(app, "recording-detail-duration").exists)
        RecordingFixtureUITestConditions.capture(app, "saved-audio-missing-file-recovery", testCase: self)
    }

    @MainActor
    func testPlaybackRecoversAfterTheSimulatedOutputRouteLoss() throws {
        let app = XCUIApplication()
        RecordingFixtureUITestConditions.launch(app, playback: "route", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"] + AppearanceUITestConditions.observationArguments)
        var appearance: AppearanceUITestConditions.Snapshot?
        defer { restore(appearance, app: app) }
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        _ = try RecordingFixtureUITestConditions.select(app, testCase: self)
        let whole = app.buttons["녹음 전체 듣기"]
        FormUITestConditions.reveal(whole, in: app, scrollID: "recording-controls-scroll")
        whole.tap()
        let error = node(app, "recording-playback-error")
        XCTAssertTrue(UITestConditions.exists(error, timeout: 10))
        XCTAssertTrue(UITestConditions.text(error).contains("오디오 기기"))
        let play = reveal(app, "recording-playback-button")
        play.tap()
        // The recovered two-second source can finish while AX remeasures its
        // already-visible row. Stop this playback first, then observe progress
        // in a separate playback without racing both assertions in one second.
        let stop = app.buttons["recording-playback-stop"]
        XCTAssertTrue(UITestConditions.exists(stop, timeout: 5))
        stop.tap()
        absent(stop, timeout: 5)
        play.tap()
        progress(app)
        absent(stop, timeout: 10)
        RecordingFixtureUITestConditions.capture(app, "simulated-output-route-recovered", testCase: self)
    }

    @MainActor
    private func savedRow(_ app: XCUIApplication) -> XCUIElement {
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Synthetic transcription test recording")).firstMatch
        FormUITestConditions.reveal(row, in: app, scrollID: "recording-controls-scroll")
        return row
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func reveal(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        RecordingFixtureUITestConditions.reveal(app, id)
    }

    @MainActor
    private func progress(_ app: XCUIApplication) {
        // The two-second fixture leaves a short 00:01 interval. Filter the native text snapshot once instead of fetching existence, label and value separately.
        let observed = app.staticTexts.matching(identifier: "recording-playback-position")
            .matching(NSPredicate(format: "label == %@", "00:01")).firstMatch
        XCTAssertTrue(UITestConditions.exists(observed, timeout: 5), app.debugDescription)
    }

    @MainActor
    private func absent(_ element: XCUIElement, timeout: TimeInterval) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: timeout), .completed)
    }

    @MainActor
    private func restore(_ appearance: AppearanceUITestConditions.Snapshot?, app: XCUIApplication) {
        if let appearance {
            do {
                try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
            } catch { XCTFail("Could not restore the owned Simulator's appearance: \(error)") }
        }
        app.terminate()
    }
}
