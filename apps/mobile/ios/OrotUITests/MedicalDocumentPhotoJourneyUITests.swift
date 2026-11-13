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
        assertPhotoSource(app)
        assertZoomInteractions(app)
        tap(app, "medical-document-source-back")
        XCTAssertEqual(
            app.descendants(matching: .any)
                .matching(identifier: "medical-document-source-0").count,
            1,
            app.debugDescription,
        )
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
        XCTAssertTrue(
            node(app, "medical-document-source-original-image").waitForAppearance(),
            app.debugDescription,
        )
        XCTAssertFalse(
            node(app, "medical-document-source-original-image").label.isEmpty,
            app.debugDescription,
        )
        XCTAssertTrue(node(app, "medical-document-source-original-zoom-in").exists, app.debugDescription)
    }

    @MainActor
    private func assertZoomInteractions(_ app: XCUIApplication) {
        let image = node(app, "medical-document-source-original-image")
        guard reveal(image, in: app) else { return }

        tap(app, "medical-document-source-original-zoom-in")
        let reset = node(app, "medical-document-source-original-zoom-reset")
        XCTAssertEqual(reset.value as? String, "150%", app.debugDescription)
        let zoomOut = node(app, "medical-document-source-original-zoom-out")
        XCTAssertTrue(zoomOut.isEnabled, app.debugDescription)
        tap(app, "medical-document-source-original-zoom-reset")
        XCTAssertEqual(reset.value as? String, "100%", app.debugDescription)

        for control in [zoomOut, reset, node(app, "medical-document-source-original-zoom-in")] {
            XCTAssertGreaterThanOrEqual(control.frame.width, 44, app.debugDescription)
            XCTAssertGreaterThanOrEqual(control.frame.height, 44, app.debugDescription)
        }

        image.pinch(withScale: 1.7, velocity: 1.0)
        let observedPinch = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value != %@", "100%"),
            object: reset,
        )
        XCTAssertEqual(XCTWaiter.wait(for: [observedPinch], timeout: 5), .completed, app.debugDescription)
        XCTAssertTrue(node(app, "medical-document-source-original-zoom-out").isEnabled, app.debugDescription)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = node(app, identifier)
        guard reveal(target, in: app) else { return }
        target.tap()
    }

    /// Scroll only the current route when the actual control is not yet reachable.
    @MainActor
    private func reveal(_ target: XCUIElement, in app: XCUIApplication) -> Bool {
        guard target.waitForAppearance() else {
            XCTFail("Expected photo journey control to appear: \(app.debugDescription)")
            return false
        }
        if !target.isHittable {
            let route = node(app, "navigation-route-scroll")
            // Use the observed control position to avoid scrolling away from Back.
            if target.frame.midY < route.frame.midY {
                route.swipeDown()
            } else {
                route.swipeUp()
            }
        }
        guard target.isHittable else {
            XCTFail("Expected photo journey control to be hittable: \(app.debugDescription)")
            return false
        }
        return true
    }
}
