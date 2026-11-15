import XCTest

/// Observes only native navigation using synthetic local records; import/picker coverage remains in its original journey.
@MainActor
final class SavedDocumentNavigationUITests: OrotFailFastTestCase {
    func testSavedSourceSupportsEdgeSwipeAndSharedBackFromRecentRecords() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "medical-document-import",
            "-OROT_TEST_ASSISTANT_APPEARANCE", "synthetic",
            "-OROT_TEST_SAVED_DOCUMENT_NAVIGATION", "synthetic",
        ]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.element(app, "rag-conversation-screen").waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let all = UITestConditions.element(app, "records-recent-view-all")
        FormUITestConditions.reveal(all, in: app, scroll: UITestConditions.element(app, "navigation-route-scroll"))
        XCTAssertTrue(all.isHittable, app.debugDescription)
        all.tap()
        let source = UITestConditions.element(app, "medical-document-source-0")
        XCTAssertTrue(source.waitForAppearance() && source.isHittable, app.debugDescription)
        XCTAssertTrue(source.label.contains("Synthetic navigation document 0"), app.debugDescription)
        source.tap()
        XCTAssertTrue(UITestConditions.element(app, "medical-document-source-view").waitForAppearance(), app.debugDescription)
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(source.waitForAppearance() && source.isHittable, app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "medical-document-source-view").exists, app.debugDescription)
        source.tap()
        XCTAssertTrue(UITestConditions.element(app, "medical-document-source-view").waitForAppearance(), app.debugDescription)
        try MedicalDocumentNavigationUITestConditions.assertSharedSavedSourceBack(app)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(source.waitForAppearance() && source.isHittable, app.debugDescription)
    }
}

/// Uses UIKit's edge gesture on the real saved-source destination, not the content Back callback.
@MainActor
enum MedicalDocumentSwipeBackConditions {
    static func assertSwipeBackAndReopen(_ app: XCUIApplication) throws {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)
        let source = UITestConditions.element(app, "medical-document-source-0")
        XCTAssertTrue(source.waitForAppearance() && source.isHittable, app.debugDescription)
        XCTAssertFalse(UITestConditions.element(app, "medical-document-source-view").exists, app.debugDescription)
        source.tap()
        XCTAssertTrue(UITestConditions.element(app, "medical-document-source-view").waitForAppearance(), app.debugDescription)
        try MedicalDocumentNavigationUITestConditions.assertSharedSavedSourceBack(app)
    }
}

/// Shares the unchanged real-import launch setup without exceeding the per-file source limit.
@MainActor
enum MedicalDocumentImportLaunchConditions {
    static func launch(_ app: XCUIApplication, fixture: String, largeText: Bool = false) {
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "medical-document-import",
            "-OROT_TEST_MEDICAL_DOCUMENT_FIXTURE", fixture,
            // Opt into the existing encrypted synthetic appearance fixture before the real app mounts.
            "-OROT_TEST_ASSISTANT_APPEARANCE", "synthetic",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        app.launch()
        XCTAssertTrue(UITestConditions.element(app, "rag-conversation-screen").waitForAppearance(), app.debugDescription)
        DebugUITestConditions.dismissWarningToast(app)
    }
}
