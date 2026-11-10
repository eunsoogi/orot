import XCTest

/// Drives the real report view while only the synthetic preview read is held.
final class DailyReportLoadingUITests: OrotFailFastTestCase {
    @MainActor
    func testSavedReportRemainsUsableWhilePreviewFailsAndRetries() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "daily-report-visual",
            "-OROT_DAILY_REPORT_PREVIEW", "controlled",
            "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }

        let scroll = UITestConditions.element(app, "daily-report-screen")
        let date = UITestConditions.element(app, "daily-report-date")
        let loading = scroll.staticTexts.matching(identifier: "기록과 저장된 보고서를 확인하고 있어요.").firstMatch
        let saved = scroll.staticTexts.matching(identifier: "합성 심박수 기록은 72회예요.").firstMatch
        let failure = scroll.staticTexts.matching(identifier: "저장된 보고서를 확인하지 못했어요. 다시 시도해 주세요.").firstMatch
        let ready = scroll.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "까지 확인한 기록 1건")).firstMatch
        let reject = app.buttons["daily-report-fixture-reject-preview"]
        let release = app.buttons["daily-report-fixture-release-preview"]
        let retry = app.buttons["다시 확인"]

        XCTAssertTrue(loading.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(date.exists && date.isHittable, date.debugDescription)
        XCTAssertTrue(UITestConditions.text(date).contains("2035-01-01"))
        XCTAssertFalse(ready.exists || failure.exists)
        scroll.swipeUp()
        try assertSavedFits(saved, in: scroll, app: app)
        XCTAssertTrue(loading.exists, "Scrolling the report must leave the preview pending.")
        attach(app, phase: "pending")

        UITestConditions.scrollTo(reject, in: scroll, searchTowardTop: true)
        XCTAssertTrue(reject.isEnabled, reject.debugDescription)
        reject.tap()
        XCTAssertTrue(failure.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(loading.exists || ready.exists)
        try assertSavedFits(saved, in: scroll, app: app)
        attach(app, phase: "rejected")

        UITestConditions.scrollToAndTap(retry, in: scroll)
        XCTAssertTrue(loading.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(failure.exists || ready.exists)
        try assertSavedFits(saved, in: scroll, app: app)
        UITestConditions.scrollTo(release, in: scroll, searchTowardTop: true)
        XCTAssertTrue(release.isEnabled, release.debugDescription)
        release.tap()
        XCTAssertTrue(ready.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(loading.exists || failure.exists)
        try assertSavedFits(saved, in: scroll, app: app)
        attach(app, phase: "released")
    }

    @MainActor
    private func assertSavedFits(_ saved: XCUIElement, in scroll: XCUIElement, app: XCUIApplication) throws {
        XCTAssertTrue(saved.waitForAppearance(), app.debugDescription)
        // Reveal uses real drag gestures when needed; a partially visible label is insufficient.
        let frame = try XCTUnwrap(FormUITestConditions.reveal(saved, in: app, scroll: scroll, keyboardMayBeVisible: false))
        XCTAssertTrue(saved.exists && saved.isHittable, saved.debugDescription)
        let viewport = app.frame.intersection(scroll.frame)
        XCTAssertTrue(viewport.insetBy(dx: -1, dy: -1).contains(frame), saved.debugDescription)
    }

    @MainActor
    private func attach(_ app: XCUIApplication, phase: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "daily-report-preview-\(phase)"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "daily-report-preview-\(phase)-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}
