import XCTest

/// Selects the host-seeded synthetic image through Photos and reads the committed source after relaunch.
final class MedicalDocumentPhotoJourneyUITests: OrotFailFastTestCase {
    /// Captures the system extension's actual accessibility tree before selecting an observed item.
    @MainActor
    func testSystemPhotoPickerAccessibilityObservation() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "medical-document-import", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-photo")
        XCTAssertTrue(app.navigationBars["Photos"].waitForAppearance(), app.debugDescription)
        // The bundle identifier was read from the running PhotosPicker extension's Info.plist.
        let picker = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow.photospicker")
        let tree = picker.debugDescription
        let attachment = XCTAttachment(string: tree)
        attachment.name = "system-photo-picker-accessibility"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("SYSTEM_PHOTO_PICKER_ACCESSIBILITY \(tree)")
    }
    @MainActor
    func testSelectedPhotoSavesAndSurvivesRelaunch() throws {
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
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-photo")

        // The host seeds one synthetic image in the owned Simulator; selection remains in PHPicker.
        XCTAssertTrue(app.navigationBars["Photos"].waitForAppearance(), app.debugDescription)
        // The Duo system extension exposes photo assets as images, not app-owned cells.
        let photo = ProcessInfo.processInfo.environment["OROT_DUO_PHOTO_VALIDATION"] == "YES"
            ? XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow.photospicker").images.matching(identifier: "PXGGridLayout-Info").firstMatch
            : app.collectionViews.cells.firstMatch
        XCTAssertTrue(photo.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(photo.isHittable, app.debugDescription)
        photo.tap()
        XCTAssertTrue(node(app, "medical-document-review-title").waitForAppearance(), app.debugDescription)
        XCTAssertTrue(node(app, "medical-document-review-original-photo").exists, app.debugDescription)
        let text = node(app, "medical-document-review-text-0")
        XCTAssertTrue(UITestConditions.text(text).lowercased().contains("synthetic clinic"), app.debugDescription)
        if ProcessInfo.processInfo.environment["OROT_DUO_PHOTO_VALIDATION"] == "YES" {
            let root = try NavigationUITestConditions.navigationAction(app, "navigation-tab-records")
            let save = node(app, "medical-document-save")
            let cancel = node(app, "medical-document-cancel")
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
        assertPhotoSource(app)
        app.terminate()
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "medical-document-source-0")
        assertPhotoSource(app)
    }

    @MainActor
    private func assertPhotoSource(_ app: XCUIApplication) {
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
