import XCTest

/// Verifies the saved-source detail uses the shared native Back control rather than a content link.
@MainActor
enum MedicalDocumentNavigationUITestConditions {
    static func assertSharedSavedSourceBack(_ app: XCUIApplication) throws {
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        XCTAssertTrue(back.control.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(back.control.frame.width, 44)
        XCTAssertGreaterThanOrEqual(back.control.frame.height, 44)
        XCTAssertFalse(UITestConditions.element(app, "medical-document-source-back").exists, app.debugDescription)
    }
}

/// Selects the host-seeded synthetic image through Photos and reads the committed source after relaunch.
final class MedicalDocumentPhotoJourneyUITests: OrotFailFastTestCase {
    @MainActor
    func testSelectedPhotoSavesAndSurvivesRelaunch() throws {
        // Xcode strips TEST_RUNNER_ when forwarding the admitted Duo flag to XCTest.
        let isDuoPhotoValidation =
            ProcessInfo.processInfo.environment["OROT_DUO_PHOTO_VALIDATION"] == "YES"
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "medical-document-import",
            "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)

        // Capture the existing Back control in the same window before entering the document detail.
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
        let referenceBack = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let referenceBackFrame = referenceBack.control.frame
        let referenceToolbarFrame = referenceBack.toolbar.frame
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])

        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-photo")

        // The host seeds one synthetic image in the owned Simulator; selection remains in PHPicker.
        XCTAssertTrue(app.navigationBars["Photos"].waitForAppearance(), app.debugDescription)
        // The Duo system extension exposes photo assets as images, not app-owned cells.
        let photo = isDuoPhotoValidation
            ? XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow.photospicker").images.matching(identifier: "PXGGridLayout-Info").firstMatch
            : app.collectionViews.cells.firstMatch
        XCTAssertTrue(photo.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(photo.isHittable, app.debugDescription)
        photo.tap()
        XCTAssertTrue(node(app, "medical-document-review-title").waitForAppearance(), app.debugDescription)
        XCTAssertTrue(node(app, "medical-document-review-original-photo").exists, app.debugDescription)
        let text = node(app, "medical-document-review-text-0")
        XCTAssertTrue(UITestConditions.text(text).lowercased().contains("synthetic clinic"), app.debugDescription)
        if isDuoPhotoValidation {
            let root = try NavigationUITestConditions.navigationAction(app, "navigation-tab-records")
            let save = node(app, "medical-document-save")
            let cancel = node(app, "medical-document-cancel")
            let review = node(app, "medical-document-review-content")
            XCTAssertTrue(review.exists, app.debugDescription)
            XCTAssertGreaterThan(root.toolbar.frame.height, root.toolbar.frame.width)
            XCTAssertGreaterThanOrEqual(root.toolbar.frame.minX, review.frame.maxX - 1)
            XCTAssertTrue(save.exists && save.isHittable && cancel.exists && cancel.isHittable, app.debugDescription)
            XCTAssertGreaterThanOrEqual(save.frame.width, 44)
            XCTAssertGreaterThanOrEqual(save.frame.height, 44)
            XCTAssertGreaterThanOrEqual(cancel.frame.width, 44)
            XCTAssertGreaterThanOrEqual(cancel.frame.height, 44)
            XCTAssertFalse(save.frame.intersects(cancel.frame))
            XCTAssertFalse(save.frame.intersects(root.toolbar.frame))
            XCTAssertFalse(cancel.frame.intersects(root.toolbar.frame))
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "synthetic-photo-review-duo"
            attachment.lifetime = .keepAlways
            add(attachment)
            save.tap()
        } else {
            tap(app, "medical-document-save")
        }

        let saved = node(app, "medical-document-source-0")
        XCTAssertTrue(saved.waitForAppearance(), app.debugDescription)
        tap(app, "medical-document-source-0")
        try assertPhotoSource(app)
        let documentBack = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let documentBackFrame = documentBack.control.frame
        XCTAssertTrue(documentBack.control.isHittable, app.debugDescription)
        XCTAssertEqual(documentBack.control.label, "이전 화면으로 돌아가기")
        XCTAssertFalse(node(app, "medical-document-source-back").exists, app.debugDescription)
        XCTAssertEqual(documentBackFrame.width, referenceBackFrame.width, accuracy: 0.5, app.debugDescription)
        XCTAssertEqual(documentBackFrame.height, referenceBackFrame.height, accuracy: 0.5, app.debugDescription)
        if isDuoPhotoValidation {
            // Compare the measured rail lane and visible Back target against the same native control.
            let records = try NavigationUITestConditions.navigationAction(app, "navigation-tab-records")
            XCTAssertEqual(referenceToolbarFrame.width, 48, accuracy: 0.5, app.debugDescription)
            XCTAssertEqual(documentBack.toolbar.frame.width, referenceToolbarFrame.width, accuracy: 0.5, app.debugDescription)
            XCTAssertEqual(documentBackFrame.width, 48, accuracy: 0.5, app.debugDescription)
            XCTAssertEqual(documentBackFrame.height, referenceBackFrame.height, accuracy: 0.5, app.debugDescription)
            XCTAssertEqual(documentBackFrame.midX, referenceBackFrame.midX, accuracy: 1, app.debugDescription)
            XCTAssertEqual(records.toolbar.frame.minY - documentBackFrame.maxY, 4, accuracy: 1, app.debugDescription)
        } else {
            // Bottom Back shares the tab row; the Duo rail instead anchors it above the tab material.
            let records = try NavigationUITestConditions.navigationAction(app, "navigation-tab-records")
            XCTAssertEqual(documentBackFrame.midY, referenceBackFrame.midY, accuracy: 1, app.debugDescription)
            XCTAssertEqual(documentBackFrame.midY, records.control.frame.midY, accuracy: 1, app.debugDescription)
            XCTAssertEqual(records.toolbar.frame.minX - documentBackFrame.maxX, 12, accuracy: 1, app.debugDescription)
            XCTAssertTrue(records.control.isHittable, app.debugDescription)
        }
        app.terminate()
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "medical-document-source-0")
        try assertPhotoSource(app)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(node(app, "medical-document-source-0").isHittable, app.debugDescription)
    }

    @MainActor
    private func assertPhotoSource(_ app: XCUIApplication) throws {
        try MedicalDocumentNavigationUITestConditions.assertSharedSavedSourceBack(app)
        XCTAssertTrue(node(app, "medical-document-source-title").waitForAppearance(), app.debugDescription)
        XCTAssertTrue(node(app, "medical-document-source-evidence").exists, app.debugDescription)
        XCTAssertTrue(
            UITestConditions.text(node(app, "medical-document-source-text-0"))
                .lowercased().contains("synthetic clinic"),
            app.debugDescription,
        )
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = node(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        let route = node(app, "navigation-route-scroll")
        XCTAssertEqual(route.scrollViews.count, 1, app.debugDescription)
        let scroll = route.scrollViews.firstMatch
        FormUITestConditions.reveal(target, in: app, scroll: scroll)
        XCTAssertTrue(target.isHittable && scroll.frame.contains(target.frame), app.debugDescription)
        target.tap()
    }
}
