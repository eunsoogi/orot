import XCTest

/// Inspects the production library with disposable audio and synthetic transcript output, separately from authentic recognition.
final class RecordingLibraryUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testRecordingConsentAndSeparateLibraryAcrossAppearanceChanges() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var appearance: AppearanceUITestConditions.Snapshot?
        defer {
            restoreAppearance(appearance, app: app)
            app.terminate()
        }
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        UITestConditions.element(app, "records-new-recording").tap()
        let consent = UITestConditions.element(app, "recording-consent")
        XCTAssertTrue(UITestConditions.exists(consent))
        XCTAssertTrue(UITestConditions.text(UITestConditions.element(app, "recording-consent-status")).contains("동의 확인이 필요해요"))
        XCTAssertFalse(UITestConditions.element(app, "recording-library-panel").exists)
        capture(app, "recording-consent-light-unchecked")
        consent.tap()
        XCTAssertTrue(app.staticTexts["동의 확인됨"].waitForAppearance())
        capture(app, "recording-consent-light-checked")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(app.staticTexts["동의 확인됨"].exists)
        capture(app, "recording-consent-dark-checked")
        consent.tap()
        XCTAssertTrue(app.staticTexts["동의 확인이 필요해요"].exists)
        capture(app, "recording-consent-dark-unchecked")
        consent.tap()
        XCTAssertTrue(app.staticTexts["동의 확인됨"].exists)
        UITestConditions.element(app, "recording-open-saved").tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "recording-library-panel")))
        XCTAssertTrue(UITestConditions.element(app, "saved-recordings-new").exists)
        XCTAssertFalse(UITestConditions.element(app, "recording-microphone-control").isHittable)
        capture(app, "saved-recordings-dark")
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self)
        capture(app, "saved-recordings-light")
    }

    /// Synthetic state proves production pause/resume UI and theme, separately from microphone capture.
    @MainActor
    func testActiveAndPausedRecordingControlsAcrossAppearanceChanges() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "recording-session-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            restoreAppearance(original, app: app)
            app.terminate()
        }
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            let suffix = dark ? "dark" : "light"
            let pause = UITestConditions.element(app, "recording-pause")
            XCTAssertTrue(UITestConditions.exists(pause))
            XCTAssertTrue(pause.isHittable)
            let position = pause.frame
            capture(app, "recording-active-\(suffix)-synthetic-state")
            pause.tap()
            let resume = UITestConditions.element(app, "recording-resume")
            XCTAssertTrue(UITestConditions.exists(resume))
            XCTAssertEqual(UITestConditions.text(UITestConditions.element(app, "recording-status")), "일시 정지됨")
            XCTAssertEqual(resume.frame.midX, position.midX, accuracy: 1)
            XCTAssertEqual(resume.frame.midY, position.midY, accuracy: 1)
            capture(app, "recording-paused-\(suffix)-synthetic-state")
            resume.tap()
            XCTAssertTrue(UITestConditions.exists(pause))
            XCTAssertEqual(UITestConditions.text(UITestConditions.element(app, "recording-status")), "녹음 중")
        }
    }

    @MainActor
    private func restoreAppearance(_ appearance: AppearanceUITestConditions.Snapshot?, app: XCUIApplication) {
        guard let appearance else { return }
        do { try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self) }
        catch { XCTFail("Could not restore Simulator appearance: \(error)") }
    }

    @MainActor
    func testSavedMetadataAndTranscriptReviewRemainReadableAcrossLiveAppearanceChanges() throws {
        try inspect(extra: [], suffix: "default", dark: false, liveTheme: true, review: true)
    }

    @MainActor
    func testSelectedRecordingAndCorrectionHistoryRemainReachableWithLargeText() throws {
        try inspect(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"], suffix: "xxxl", dark: true, liveTheme: false, review: true)
    }

    @MainActor
    func testSavedRecordingRowsAndDraftRemainReadableInA320PointViewport() throws {
        try inspect(extra: ["-OROT_RECORDING_VISUAL_WIDTH", "320"], suffix: "320pt", dark: false, liveTheme: false, review: false)
    }

    @MainActor
    private func inspect(extra: [String], suffix: String, dark: Bool, liveTheme: Bool, review: Bool) throws {
        let app = XCUIApplication()
        let inputObservation = review ? ["-OROT_TEST_INPUT_OBSERVATION", "YES"] : []
        RecordingFixtureUITestConditions.launch(app, extra: extra + inputObservation + AppearanceUITestConditions.observationArguments)
        var appearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let appearance {
                do {
                    try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
                } catch { XCTFail("Could not restore the owned Simulator's appearance: \(error)") }
            }
            app.terminate()
        }
        _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        let row = try RecordingFixtureUITestConditions.select(app, testCase: self)
        XCTAssertTrue(row.label.contains("Synthetic transcription test recording"))
        XCTAssertTrue(app.staticTexts["전사 전"].exists)
        XCTAssertTrue(app.staticTexts["00:02"].exists)
        if suffix == "320pt" {
            XCTAssertEqual(UITestConditions.element(app, "recording-controls-scroll").frame.width, 320, accuracy: 0.5)
        }
        capture(app, "recording-library-list-\(suffix)")
        row.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "recording-detail")))
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "transcript-panel")))
        let duration = reveal(app, "recording-detail-duration")
        XCTAssertNotEqual(UITestConditions.text(duration), "길이 확인 불가")
        XCTAssertTrue(UITestConditions.element(app, "recording-detail-date").exists)
        XCTAssertTrue(UITestConditions.element(app, "recording-playback-button").exists)
        capture(app, "recording-library-detail-\(suffix)")
        reveal(app, "transcript-create").tap()
        _ = reveal(app, "transcript-text-0")
        XCTAssertEqual(UITestConditions.text(reveal(app, "transcript-review-0")), "검토 전 초안")
        XCTAssertFalse(UITestConditions.element(app, "transcript-engine-0").exists)
        XCTAssertFalse(UITestConditions.element(app, "transcript-runtime-0").exists)
        capture(app, "recording-transcript-review-\(suffix)")
        if liveTheme {
            _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
            capture(app, "recording-transcript-review-dark-live")
        }
        if review {
            reveal(app, "transcript-edit-0").tap()
            let input = UITestConditions.element(app, "transcript-input-0")
            FormUITestConditions.replace(input, with: "화면 검토용 합성 전사 수정", in: app, scrollID: "recording-controls-scroll")
            capture(app, "recording-transcript-editor-\(suffix)")
            let save = UITestConditions.element(app, "transcript-save-0")
            // Keep the scroll gesture outside the oversized editor while its keyboard is open.
            FormUITestConditions.reveal(
                save,
                in: app,
                scrollID: "recording-controls-scroll",
                horizontalPosition: 0.9,
            )
            save.tap()
            let history = reveal(app, "transcript-history-0-1")
            XCTAssertTrue(UITestConditions.text(history).contains("이전 버전 1:"))
            capture(app, "recording-transcript-history-\(suffix)")
            reveal(app, "transcript-play-0").tap()
            _ = reveal(app, "transcript-error", towardTop: true)
            capture(app, "recording-transcript-error-\(suffix)")
            if liveTheme {
                _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self)
                capture(app, "recording-transcript-error-light-live")
            }
        }
        // Reveal the redesigned export choices without opening the native share sheet.
        XCTAssertTrue(reveal(app, "recording-export-audio").isHittable)
        capture(app, "recording-export-panel-\(suffix)")
    }

    @MainActor
    private func reveal(_ app: XCUIApplication, _ id: String, towardTop: Bool = false) -> XCUIElement {
        RecordingFixtureUITestConditions.reveal(app, id, towardTop: towardTop)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        RecordingFixtureUITestConditions.capture(app, name, testCase: self)
    }
}
