import XCTest

/// Measures the real shell and its feature scrollers. The health fixture supplies no personal HealthKit data.
final class SafeAreaNavigationUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSystemInsetsAcrossHomeHealthImportRecordingAndBloodPressureLibrary() throws {
        let app = launch(probe: "safe-area-blood-pressure")
        defer { app.terminate() }
        // These routes request no personal records and start no recording. Keep their original assertions in named activities while sharing one native launch.
        try XCTContext.runActivity(named: "Home, Records and Settings health-data insets") { _ in try verifyHomeAndHealthImport(app) }
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        // The selected but unimported categories retain the real leave guard. Discard only this synthetic selection before continuing the shared journey.
        let leave = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(UITestConditions.exists(leave))
        leave.buttons["내용 버리고 나가기"].tap()
        // Health Data opened from Settings, so return there before choosing the Records tab for recording checks.
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try XCTContext.runActivity(named: "Recording inner scroller and floating toolbar") { _ in try verifyRecording(app) }
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try XCTContext.runActivity(named: "Imported health records and final library row") { _ in try verifyBloodPressure(app) }
    }

    @MainActor
    private func verifyHomeAndHealthImport(_ app: XCUIApplication) throws {
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try inset(app, "welcome-title")
        try inset(app, "navigation-route-scroll")
        capture(app, "home-top-safe-area")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try inset(app, "records-title")
        capture(app, "records-top-safe-area")
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        let imported = node(app, "records-open-health-library")
        XCTAssertTrue(imported.exists && imported.isHittable)
        try inset(app, "records-open-health-library", bottom: true, top: false)
        XCTAssertFalse(node(app, "records-open-common-observations").exists)
        XCTAssertFalse(node(app, "records-open-blood-pressure").exists)
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        let healthData = node(app, "settings-open-health-data")
        XCTAssertTrue(healthData.exists && healthData.isHittable)
        healthData.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "health-data-scroll")))
        let category = node(app, "health-data-feature-heartRate")
        FormUITestConditions.reveal(category, in: app, scrollID: "health-data-scroll")
        category.tap()
        try inset(app, "health-data-scroll")
        try NavigationUITestConditions.scrollToBottom(app, "health-data-scroll")
        let action = node(app, "health-data-save")
        XCTAssertTrue(action.exists && action.isHittable && action.isEnabled)
        try inset(app, "health-data-save", bottom: true, top: false)
    }

    @MainActor
    private func verifyRecording(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let open = node(app, "records-new-recording")
        FormUITestConditions.reveal(open, in: app, scrollID: "navigation-route-scroll")
        open.tap()
        let action = node(app, "recording-microphone-control")
        XCTAssertTrue(UITestConditions.exists(action))
        try inset(app, "recording-title")
        try inset(app, "recording-controls-scroll")
        XCTAssertFalse(node(app, "navigation-route-scroll").exists)
        XCTAssertTrue(action.isHittable)
        let root = try rootFrame(app, containing: action.frame)
        let scroll = node(app, "recording-controls-scroll")
        let contentRegion = node(app, "navigation-content-region")
        XCTAssertTrue(contentRegion.exists && !contentRegion.frame.isEmpty)
        let hasRightRail = node(app, "navigation-right-rail").exists
        let rightRail = try NavigationUITestConditions.navigationAction(app, "navigation-back").toolbar
        if hasRightRail {
            // Content stops at its safe edge or the actual native bar, whichever comes first.
            XCTAssertFalse(rightRail.frame.isEmpty)
            XCTAssertEqual(contentRegion.frame.minX, root.minX, accuracy: 0.5)
            let safeArea = try NavigationUITestConditions.safeArea(app, testCase: self)
            XCTAssertEqual(contentRegion.frame.maxX, min(root.maxX - safeArea.right, rightRail.frame.minX), accuracy: 0.5)
            XCTAssertEqual(rightRail.frame.width, 48, accuracy: 0.5)
            XCTAssertEqual(rightRail.frame.maxX, app.frame.maxX - 12, accuracy: 0.5)
            let systemBottomInset = safeArea.bottom
            XCTAssertGreaterThanOrEqual(scroll.frame.minX, contentRegion.frame.minX - 0.5)
            XCTAssertLessThanOrEqual(scroll.frame.maxX, contentRegion.frame.maxX + 0.5)
            XCTAssertLessThanOrEqual(scroll.frame.maxY, root.maxY - systemBottomInset + 0.5)
            XCTAssertLessThanOrEqual(action.frame.maxX, contentRegion.frame.maxX + 0.5)
            XCTAssertLessThanOrEqual(action.frame.maxY, root.maxY - systemBottomInset + 0.5)
            XCTAssertFalse(scroll.frame.intersects(rightRail.frame))
            XCTAssertFalse(action.frame.intersects(rightRail.frame))
        } else {
            XCTAssertEqual(scroll.frame.maxY, root.maxY, accuracy: 0.5)
            let bar = try NavigationUITestConditions.navigationAction(app, "navigation-back").toolbar
            XCTAssertLessThanOrEqual(action.frame.maxY, bar.frame.minY)
        }
        capture(app, "recording-inner-scroll-floating-bar-safe-area")
    }

    @MainActor
    private func verifyBloodPressure(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        let library = node(app, "records-open-health-library")
        FormUITestConditions.reveal(library, in: app, scrollID: "navigation-route-scroll")
        library.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "health-records-title")))
        let detail = node(app, "health-record-open-detail-blood_pressure")
        FormUITestConditions.reveal(detail, in: app, scrollID: "health-records-scroll")
        detail.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "health-records-detail-title")))
        XCTAssertTrue(UITestConditions.exists(node(app, "health-record-row-0")))
        XCTAssertFalse(node(app, "navigation-route-scroll").exists)
        let detailScroll = node(app, "health-records-detail-scroll")
        let detailRoot = try rootFrame(app, containing: detailScroll.frame)
        let contentViewport = node(app, "navigation-content-region")
        XCTAssertTrue(contentViewport.exists && !contentViewport.frame.isEmpty)
        let hasRightRail = node(app, "navigation-right-rail").exists
        let rightRail = try NavigationUITestConditions.navigationAction(app, "navigation-back").toolbar
        if hasRightRail {
            // A contracted content root may end before the window-side native rail.
            XCTAssertFalse(rightRail.frame.isEmpty)
            let safeArea = try NavigationUITestConditions.safeArea(app, testCase: self)
            XCTAssertEqual(contentViewport.frame.maxX, min(detailRoot.maxX - safeArea.right, rightRail.frame.minX), accuracy: 0.5)
            XCTAssertEqual(rightRail.frame.width, 48, accuracy: 0.5)
            XCTAssertEqual(rightRail.frame.maxX, app.frame.maxX - 12, accuracy: 0.5)
            let systemBottomInset = safeArea.bottom
            XCTAssertLessThanOrEqual(detailScroll.frame.maxX, contentViewport.frame.maxX + 0.5)
            XCTAssertLessThanOrEqual(detailScroll.frame.maxY, detailRoot.maxY - systemBottomInset + 0.5)
        } else {
            XCTAssertEqual(detailScroll.frame.minX, detailRoot.minX, accuracy: 0.5)
            XCTAssertEqual(detailScroll.frame.maxX, detailRoot.maxX, accuracy: 0.5)
            XCTAssertEqual(detailScroll.frame.maxY, detailRoot.maxY, accuracy: 0.5)
        }
        let last = node(app, "health-record-row-11")
        FormUITestConditions.reveal(last, in: app, scrollID: "health-records-detail-scroll")
        try NavigationUITestConditions.scrollToBottom(app, "health-records-detail-scroll")
        XCTAssertTrue(last.exists && last.isHittable)
        if hasRightRail {
            XCTAssertLessThanOrEqual(last.frame.maxX, contentViewport.frame.maxX + 0.5)
        }
        try inset(app, "health-record-row-11", bottom: true, top: false)
        capture(app, "synthetic-blood-pressure-library-final-row-safe-area")
    }

    @MainActor
    private func launch(probe: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_UI_GEOMETRY", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if let probe {
            app.launchArguments += ["-OROT_E2E_PROBE", probe]
        }
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        return app
    }

    @MainActor
    private func rootFrame(_ app: XCUIApplication, containing frame: CGRect) throws -> CGRect {
        let observed = try NavigationUITestConditions.safeArea(app, testCase: self)
        let roots = app.descendants(matching: .any).matching(identifier: "navigation-keyboard-avoiding-root").allElementsBoundByIndex
        let root = try XCTUnwrap(roots.first { $0.frame.contains(frame) && $0.frame.intersects(observed.frame) })
        XCTAssertEqual(root.frame.minX, observed.frame.minX, accuracy: 0.5)
        XCTAssertEqual(root.frame.minY, observed.frame.minY, accuracy: 0.5)
        XCTAssertEqual(root.frame.width, observed.frame.width, accuracy: 0.5)
        XCTAssertEqual(root.frame.height, observed.frame.height, accuracy: 0.5)
        return root.frame
    }

    @MainActor
    private func inset(_ app: XCUIApplication, _ identifier: String, bottom: Bool = false, top: Bool = true) throws {
        let element = node(app, identifier)
        XCTAssertTrue(element.exists && !element.frame.isEmpty)
        let root = try rootFrame(app, containing: element.frame)
        // Retain the original minimum thresholds and measure the frames in the same native screen coordinate system.
        if top {
            XCTAssertGreaterThanOrEqual(element.frame.minY - root.minY, 44)
        }
        if bottom {
            XCTAssertGreaterThanOrEqual(root.maxY - element.frame.maxY, 20)
        }
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        RecordingFixtureUITestConditions.capture(app, name, testCase: self)
    }
}
