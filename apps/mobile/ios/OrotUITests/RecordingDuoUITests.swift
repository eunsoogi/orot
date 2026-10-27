import XCTest

/// Exercises the production recording route while UIKit changes the Duo window size.
final class RecordingDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testRecordingCaptureAndConsentSurviveLiveWindowReflow() throws {
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        let startingOrientation: UIDeviceOrientation = .portrait
        let changedOrientation: UIDeviceOrientation = .landscapeLeft
        defer {
            XCUIDevice.shared.orientation = originalOrientation
            UITestConditions.terminateStandaloneApp(app)
        }
        // Start in a known orientation so every run observes two distinct window sizes.
        XCUIDevice.shared.orientation = startingOrientation
        app.launch()

        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        UITestConditions.element(app, "records-new-recording").tap()

        let consent = UITestConditions.element(app, "recording-consent")
        let consentStatus = UITestConditions.element(app, "recording-consent-status")
        let microphone = UITestConditions.element(app, "recording-microphone-control")
        let status = UITestConditions.element(app, "recording-status")
        let duration = UITestConditions.element(app, "recording-duration")
        XCTAssertTrue(UITestConditions.exists(consent))
        XCTAssertFalse(microphone.isEnabled, "Recording requires explicit consent")
        consent.tap()
        XCTAssertEqual(UITestConditions.text(consentStatus), "동의 확인됨")

        // No probe arguments are supplied, so the original screen action reaches the microphone service.
        microphone.tap()
        waitForPermissionOrRecording(app, status: status)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let permission = springboard.alerts.firstMatch
        if permission.exists {
            let allow = permission.buttons.matching(
                NSPredicate(format: "label IN %@", ["Allow", "허용", "OK", "확인"]),
            ).firstMatch
            XCTAssertTrue(allow.exists, permission.debugDescription)
            allow.tap()
        }
        UITestConditions.value(status, equals: "녹음 중")
        XCTAssertFalse(consent.isEnabled)

        let before = app.windows.firstMatch.frame.width
        let elapsedBefore = UITestConditions.text(duration)
        let session = UITestConditions.element(app, "recording-session-panel")
        let guidance = UITestConditions.element(app, "recording-guidance-panel")
        let sessionFrame = session.frame
        let guidanceFrame = guidance.frame
        XCUIDevice.shared.orientation = changedOrientation
        waitForRecordingReflow(
            app,
            status: status,
            duration: duration,
            session: session,
            guidance: guidance,
            widthDifferentFrom: before,
            durationDifferentFrom: elapsedBefore,
            sessionFrameDifferentFrom: sessionFrame,
            guidanceFrameDifferentFrom: guidanceFrame,
        )
        XCTAssertEqual(UITestConditions.text(consentStatus), "동의 확인됨")
        XCTAssertFalse(consent.isEnabled)

        let changedWidth = app.windows.firstMatch.frame.width
        let changedDuration = UITestConditions.text(duration)
        let changedSessionFrame = session.frame
        let changedGuidanceFrame = guidance.frame
        XCUIDevice.shared.orientation = startingOrientation
        waitForRecordingReflow(
            app,
            status: status,
            duration: duration,
            session: session,
            guidance: guidance,
            widthDifferentFrom: changedWidth,
            durationDifferentFrom: changedDuration,
            sessionFrameDifferentFrom: changedSessionFrame,
            guidanceFrameDifferentFrom: changedGuidanceFrame,
        )
        XCTAssertEqual(UITestConditions.text(consentStatus), "동의 확인됨")
        XCTAssertFalse(consent.isEnabled)

        microphone.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "recording-result")))
    }

    /// Exercises the saved-source route with real keyboard input while native window geometry changes.
    @MainActor
    func testRecordingReviewRetainsTranscriptDraftAndSelectionAcrossWindowReflow() {
        let fixture = "recording-review-duo-" + UUID().uuidString.lowercased()
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        defer {
            cleanReviewFixture(app)
            XCUIDevice.shared.orientation = originalOrientation
        }
        XCUIDevice.shared.orientation = .portrait
        launchReviewFixture(app, fixture: fixture)

        let primary = UITestConditions.element(app, "recording-review-layout-primary")
        let secondary = UITestConditions.element(app, "recording-review-layout-secondary")
        let transcript = UITestConditions.element(app, "transcript-panel")
        let review = UITestConditions.element(app, "encounter-review-panel")
        for panel in [primary, secondary, transcript, review,
                      UITestConditions.element(app, "recording-playback-controls"),
                      UITestConditions.element(app, "recording-export-panel")]
        {
            XCTAssertTrue(UITestConditions.exists(panel), panel.identifier)
        }

        let start = UITestConditions.element(app, "encounter-start")
        FormUITestConditions.reveal(start, in: app, scrollID: "navigation-route-scroll")
        start.tap()
        let selection = UITestConditions.element(app, "encounter-select-candidate-0")
        FormUITestConditions.reveal(selection, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(selection.isSelected)
        selection.tap()
        XCTAssertFalse(selection.isSelected)

        let edit = UITestConditions.element(app, "transcript-edit-0")
        FormUITestConditions.reveal(edit, in: app, scrollID: "navigation-route-scroll")
        edit.tap()
        let input = FormUITestConditions.multilineInput(app, identifier: "transcript-input-0")
        let draft = "Duo reflow draft"
        FormUITestConditions.replace(input, with: draft, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(app.keyboards.firstMatch.waitForAppearance())

        let firstWidth = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForReviewReflow(app, previousWidth: firstWidth, primary: primary, secondary: secondary, isExpanded: true)
        UITestConditions.value(input, equals: draft)
        XCTAssertFalse(selection.isSelected)

        let secondWidth = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .portrait
        waitForReviewReflow(app, previousWidth: secondWidth, primary: primary, secondary: secondary, isExpanded: false)
        UITestConditions.value(input, equals: draft)
        XCTAssertFalse(selection.isSelected)
    }

    @MainActor
    private func launchReviewFixture(_ app: XCUIApplication, fixture: String) {
        // Seed an owned local review so this geometry case never requests a remote model or approval.
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "speech",
            "-OROT_TRANSCRIPTION_PROBE_MODE", "encounter-review",
            "-OROT_REVIEW_FIXTURE", fixture,
            "-OROT_REVIEW_MODE", "seed",
        ]
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "encounter-probe-ready"), equals: "ready")
        let row = app.buttons.matching(identifier: "recording-details-\(fixture):ui-review").firstMatch
        FormUITestConditions.reveal(row, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(row.isHittable)
        row.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "encounter-review-panel")))
    }

    @MainActor
    private func cleanReviewFixture(_ app: XCUIApplication) {
        XCUIDevice.shared.orientation = .portrait
        let cancel = UITestConditions.element(app, "transcript-cancel-0")
        if cancel.exists {
            FormUITestConditions.reveal(cancel, in: app, scrollID: "navigation-route-scroll")
            cancel.tap()
        }
        let cleanup = UITestConditions.element(app, "encounter-probe-cleanup")
        XCTAssertTrue(UITestConditions.exists(cleanup))
        XCTAssertTrue(cleanup.isHittable)
        cleanup.tap()
        UITestConditions.value(UITestConditions.element(app, "encounter-probe-report"), equals: "cleaned")
        app.terminate()
    }

    @MainActor
    private func waitForReviewReflow(
        _ app: XCUIApplication,
        previousWidth: CGFloat,
        primary: XCUIElement,
        secondary: XCUIElement,
        isExpanded: Bool,
    ) {
        let window = app.windows.firstMatch
        // A width change and separate frames can still describe the wrong layout axis.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard window.exists, primary.exists, secondary.exists else { return false }
            let primaryFrame = primary.frame
            let secondaryFrame = secondary.frame
            let panelsFollowExpectedAxis = isExpanded
                ? primaryFrame.maxX <= secondaryFrame.minX
                : primaryFrame.maxY <= secondaryFrame.minY
            return abs(window.frame.width - previousWidth) > 0.5 &&
                primaryFrame.width > 0 && secondaryFrame.width > 0 &&
                !primaryFrame.intersects(secondaryFrame) && panelsFollowExpectedAxis
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, app.debugDescription)
    }

    @MainActor
    private func waitForPermissionOrRecording(_ app: XCUIApplication, status: XCUIElement) {
        let alert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            alert.exists || UITestConditions.text(status) == "녹음 중"
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, app.debugDescription)
    }

    @MainActor
    private func waitForRecordingReflow(
        _ app: XCUIApplication,
        status: XCUIElement,
        duration: XCUIElement,
        session: XCUIElement,
        guidance: XCUIElement,
        widthDifferentFrom previousWidth: CGFloat,
        durationDifferentFrom previousDuration: String,
        sessionFrameDifferentFrom previousSessionFrame: CGRect,
        guidanceFrameDifferentFrom previousGuidanceFrame: CGRect,
    ) {
        // Wait for actual UIKit and panel geometry while the microphone duration continues advancing.
        let window = app.windows.firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard window.exists, session.exists, guidance.exists else { return false }
            let sessionFrame = session.frame
            let guidanceFrame = guidance.frame
            return abs(window.frame.width - previousWidth) > 0.5 &&
                UITestConditions.text(status) == "녹음 중" &&
                UITestConditions.text(duration) != previousDuration &&
                sessionFrame != previousSessionFrame &&
                guidanceFrame != previousGuidanceFrame &&
                !sessionFrame.intersects(guidanceFrame)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, app.debugDescription)
    }
}
