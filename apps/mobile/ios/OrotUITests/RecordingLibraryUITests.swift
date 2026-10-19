import XCTest

/// Inspects the production library with disposable audio and synthetic transcript output, separately from authentic recognition.
final class RecordingLibraryUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
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
        RecordingFixtureUITestConditions.launch(app, extra: extra + AppearanceUITestConditions.observationArguments)
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
