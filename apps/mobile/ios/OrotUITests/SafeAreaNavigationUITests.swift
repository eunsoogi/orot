import XCTest

/// Measures the real shell and its feature scrollers. The blood-pressure fixture supplies no personal HealthKit data.
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
        try XCTContext.runActivity(named: "Home, Records and Health import insets") { _ in try verifyHomeAndHealthImport(app) }
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        // The selected but unimported categories retain the real leave guard. Discard only this synthetic selection before continuing the shared journey.
        let leave = app.alerts["저장하지 않은 내용이 있어요"]
        XCTAssertTrue(UITestConditions.exists(leave))
        leave.buttons["내용 버리고 나가기"].tap()
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try XCTContext.runActivity(named: "Recording inner scroller and floating toolbar") { _ in try verifyRecording(app) }
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
        try XCTContext.runActivity(named: "Synthetic blood pressure and final library row") { _ in try verifyBloodPressure(app) }
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
        let open = node(app, "records-open-common-observations")
        XCTAssertTrue(open.exists && open.isHittable)
        try inset(app, "records-open-common-observations", bottom: true, top: false)
        open.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "common-observations-import")))
        let category = node(app, "common-observations-toggle-heartRate")
        FormUITestConditions.reveal(category, in: app, scrollID: "navigation-route-scroll")
        category.tap()
        try inset(app, "navigation-route-scroll")
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        let action = node(app, "common-observations-import")
        XCTAssertTrue(action.exists && action.isHittable && action.isEnabled)
        try inset(app, "common-observations-import", bottom: true, top: false)
    }

    @MainActor
    private func verifyRecording(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let open = node(app, "records-new-recording")
        FormUITestConditions.reveal(open, in: app, scrollID: "navigation-route-scroll")
        open.tap()
        let action = node(app, "recording-start")
        XCTAssertTrue(UITestConditions.exists(action))
        try inset(app, "recording-title")
        try inset(app, "recording-controls-scroll")
        XCTAssertFalse(node(app, "navigation-route-scroll").exists)
        XCTAssertTrue(action.isHittable)
        let root = try rootFrame(app, containing: action.frame)
        XCTAssertEqual(node(app, "recording-controls-scroll").frame.maxY, root.maxY, accuracy: 0.5)
        let bar = try NavigationUITestConditions.nativeAction(app, "navigation-back").toolbar
        XCTAssertLessThanOrEqual(action.frame.maxY, bar.frame.minY)
        capture(app, "recording-inner-scroll-floating-bar-safe-area")
    }

    @MainActor
    private func verifyBloodPressure(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try NavigationUITestConditions.scrollToBottom(app, "navigation-route-scroll")
        node(app, "records-open-blood-pressure").tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "blood-pressure-title")))
        try inset(app, "blood-pressure-scroll", bottom: true)
        try NavigationUITestConditions.scrollToBottom(app, "blood-pressure-scroll")
        let action = node(app, "blood-pressure-import")
        XCTAssertTrue(action.exists && action.isHittable && action.isEnabled)
        try inset(app, "blood-pressure-import", bottom: true, top: false)
        action.tap()
        UITestConditions.value(node(app, "blood-pressure-status"), equals: "새로 반영된 기록이 없어요")
        let library = node(app, "blood-pressure-open-library")
        FormUITestConditions.reveal(library, in: app, scrollID: "blood-pressure-scroll")
        library.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "health-records-title")))
        XCTAssertTrue(UITestConditions.exists(node(app, "health-record-row-0")))
        XCTAssertFalse(node(app, "navigation-route-scroll").exists)
        try inset(app, "health-records-scroll", bottom: true)
        let last = node(app, "health-record-row-23")
        FormUITestConditions.reveal(last, in: app, scrollID: "health-records-scroll")
        try NavigationUITestConditions.scrollToBottom(app, "health-records-scroll")
        XCTAssertTrue(last.exists && last.isHittable)
        try inset(app, "health-record-row-23", bottom: true, top: false)
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
