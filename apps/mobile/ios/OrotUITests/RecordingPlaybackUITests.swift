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
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-detail")))
        let play = reveal(app, "recording-playback-button")
        play.tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["녹음 재생 중…"]))
        progress(app)
        let stop = app.buttons["recording-playback-stop"]
        XCTAssertTrue(UITestConditions.exists(stop))
        XCTAssertTrue(stop.isHittable)
        stop.tap()
        terminal(app, expected: "stopped")
        absent(stop)
        // The explicit Stop fixture owns its lifetime. Natural completion uses the original one-shot saved file.
        app.terminate()
        resume(app)
        savedRow(app).tap()
        reveal(app, "recording-playback-button").tap()
        terminal(app, expected: "completed")
        absent(node(app, "recording-playback-stop"))
        // Resume never reseeds audio or metadata, so this restart exercises the actual saved file.
        app.terminate()
        RecordingFixtureUITestConditions.launch(app, playback: "resume", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"] + AppearanceUITestConditions.observationArguments)
        let restored = savedRow(app)
        restored.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-detail")))
        reveal(app, "recording-playback-button").tap()
        terminal(app, expected: "completed")
        absent(node(app, "recording-playback-stop"))
        XCTAssertTrue(node(app, "recording-detail-duration").exists)
        app.terminate()
        RecordingFixtureUITestConditions.launch(app, playback: "missing", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"] + AppearanceUITestConditions.observationArguments)
        let retained = savedRow(app)
        retained.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "recording-detail-duration")))
        reveal(app, "recording-playback-button").tap()
        let error = node(app, "recording-playback-error")
        XCTAssertTrue(UITestConditions.exists(error))
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
        XCTAssertTrue(UITestConditions.exists(error))
        XCTAssertTrue(UITestConditions.text(error).contains("오디오 기기"))
        let play = reveal(app, "recording-playback-button")
        play.tap()
        // The recovered real player loops only in the Stop fixture, so observer speed cannot remove the control.
        progress(app)
        let stop = app.buttons["recording-playback-stop"]
        XCTAssertTrue(UITestConditions.exists(stop))
        XCTAssertTrue(stop.isHittable)
        stop.tap()
        terminal(app, expected: "stopped")
        absent(stop)
        app.terminate()
        resume(app)
        savedRow(app).tap()
        reveal(app, "recording-playback-button").tap()
        terminal(app, expected: "completed")
        absent(node(app, "recording-playback-stop"))
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
        let receipt = observation(app) {
            ($0["maximumPositionMs"] as? Double ?? 0) >= 1000 || ["failed", "completed"].contains($0["phase"] as? String ?? "")
        }
        // The exact 00:01 rendering assertion remains in RecordingPlaybackControls.test.tsx.
        // Here a retained real clock observation cannot disappear when the saved clip loops.
        XCTAssertEqual(receipt["phase"] as? String, "requested")
        XCTAssertEqual(receipt["nativePlaying"] as? Bool, true)
        XCTAssertGreaterThanOrEqual(receipt["maximumPositionMs"] as? Double ?? 0, 1000)
    }

    @MainActor
    private func terminal(_ app: XCUIApplication, expected: String) {
        let receipt = observation(app) { ["completed", "stopped", "failed"].contains($0["phase"] as? String ?? "") }
        XCTAssertEqual(receipt["phase"] as? String, expected, String(describing: receipt))
        XCTAssertEqual(receipt["nativePlaying"] as? Bool, true)
        guard let range = receipt["range"] as? [String: Any] else { return XCTFail("Missing real player completion") }
        XCTAssertEqual(range["completion"] as? String, expected)
        XCTAssertEqual(range["actualStartMs"] as? Int, 0)
        if expected == "completed" {
            XCTAssertEqual(range["actualEndMs"] as? Int, range["endMs"] as? Int)
            XCTAssertGreaterThan(range["actualEndMs"] as? Int ?? 0, 0)
        }
    }

    @MainActor
    private func observation(_ app: XCUIApplication, matching condition: @escaping ([String: Any]) -> Bool) -> [String: Any] {
        var retained: [String: Any] = [:]
        let target = node(app, "recording-playback-observation")
        let observed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let snapshot = try? target.snapshot(), let data = snapshot.label.data(using: .utf8),
                  let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
            retained = value
            return condition(value)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [observed]), .completed)
        return retained
    }

    @MainActor
    private func resume(_ app: XCUIApplication) {
        RecordingFixtureUITestConditions.launch(app, playback: "resume", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"] + AppearanceUITestConditions.observationArguments)
    }

    @MainActor
    private func absent(_ element: XCUIElement) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        XCTAssertEqual(UITestConditions.wait(for: [gone]), .completed)
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
