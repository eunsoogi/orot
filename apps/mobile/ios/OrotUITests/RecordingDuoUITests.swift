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
