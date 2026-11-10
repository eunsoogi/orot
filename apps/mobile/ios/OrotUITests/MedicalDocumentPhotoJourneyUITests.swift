import XCTest

/// Selects the host-seeded synthetic image through Photos and reads the committed source after relaunch.
final class MedicalDocumentPhotoJourneyUITests: OrotFailFastTestCase {
    @MainActor
    func testSelectedPhotoSavesAndSurvivesRelaunch() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "medical-document-import",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-photo")

        // The host seeds one synthetic image in the owned Simulator; selection remains in PHPicker.
        XCTAssertTrue(app.navigationBars["Photos"].waitForAppearance(), app.debugDescription)
        let photo = app.collectionViews.cells.firstMatch
        XCTAssertTrue(photo.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(photo.isHittable, app.debugDescription)
        photo.tap()
        XCTAssertTrue(node(app, "medical-document-review-title").waitForAppearance(), app.debugDescription)
        XCTAssertTrue(node(app, "medical-document-review-original-photo").exists, app.debugDescription)
        let text = node(app, "medical-document-review-text-0")
        XCTAssertTrue(UITestConditions.text(text).lowercased().contains("synthetic clinic"), app.debugDescription)
        tap(app, "medical-document-save")

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
