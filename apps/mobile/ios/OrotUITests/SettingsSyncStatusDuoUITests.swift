import XCTest

/// Keeps the sync-status scenario in Duo's measured regions; the launch helper follows the appearance flags' `MainActor` isolation.
final class SettingsSyncStatusDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSyncStatusAndRecoveryStayInsideDuoRegionsAcrossReflow() throws {
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        var appearance: AppearanceUITestConditions.Snapshot?
        XCUIDevice.shared.orientation = .portrait
        let regularArguments = launchArguments(largeText: false)
        XCTAssertEqual(Array(regularArguments.suffix(4)), AppearanceUITestConditions.observationArguments)
        app.launchArguments = regularArguments
        app.launch()
        defer {
            if let appearance, app.state == .runningForeground {
                do {
                    try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
                } catch {
                    XCTFail("Could not restore the original Simulator appearance: \(error)")
                }
            }
            XCUIDevice.shared.orientation = originalOrientation
            app.terminate()
        }

        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        saveSyntheticSelection(app)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["settings-title"])
        openSyncStatus(app)
        let regularTitleHeight = node(app, "settings-sync-status-title").frame.height
        assertSavedSyncState(app)
        try assertPanelsFollowMeasuredSpace(app, phase: "portrait")

        appearance = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
            captureOriginal: { appearance = $0 },
        )
        assertSavedSyncState(app)
        try assertPanelsFollowMeasuredSpace(app, phase: "dark")

        let portraitWidth = app.windows.firstMatch.frame.width
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForWindowWidthChange(app, from: portraitWidth)
        assertSavedSyncState(app)
        try assertPanelsFollowMeasuredSpace(app, phase: "landscape")

        if let originalAppearance = appearance {
            try AppearanceUITestConditions.restore(originalAppearance, returningTo: app, testCase: self)
            appearance = nil
        }
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        let largeTextArguments = launchArguments(largeText: true)
        XCTAssertEqual(Array(largeTextArguments.suffix(4)), AppearanceUITestConditions.observationArguments)
        app.launchArguments = largeTextArguments
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        openSyncStatus(app)
        XCTAssertGreaterThan(
            node(app, "settings-sync-status-title").frame.height,
            regularTitleHeight + 1,
            "The status heading must grow from its regular-size presentation",
        )
        assertSavedSyncState(app)
        try assertPanelsFollowMeasuredSpace(app, phase: "large-text", expectsStacked: true)
    }

    @MainActor
    private func saveSyntheticSelection(_ app: XCUIApplication) {
        tap(app, "settings-open-health-data")
        NavigationUITestConditions.route(app, markers: ["health-data-title"])
        let requested = Set(["bloodPressure", "medications"])
        let save = node(app, "health-data-save")
        XCTAssertTrue(save.waitForAppearance(), app.debugDescription)
        let selectionLoaded = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in save.isEnabled },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [selectionLoaded]), .completed, app.debugDescription)
        for feature in ["bloodPressure", "medications", "heartRate", "sleep", "steps", "bodyMass"] {
            let choice = node(app, "health-data-feature-\(feature)")
            XCTAssertTrue(choice.waitForAppearance(), app.debugDescription)
            if checkboxIsChecked(choice) != requested.contains(feature) {
                choice.tap()
            }
            XCTAssertEqual(checkboxIsChecked(choice), requested.contains(feature), app.debugDescription)
        }
        tap(app, "health-data-save")
        let saved = node(app, "health-data-status")
        let completed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                saved.exists && UITestConditions.text(saved).contains("자동 동기화 설정을 저장했어요.")
            },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [completed]), .completed, app.debugDescription)
    }

    @MainActor
    private func openSyncStatus(_ app: XCUIApplication) {
        tap(app, "settings-open-sync-status")
        NavigationUITestConditions.route(app, markers: ["settings-sync-status-title"])
    }

    @MainActor
    private func assertSavedSyncState(_ app: XCUIApplication) {
        let message = node(app, "settings-sync-status-message")
        let categories = node(app, "settings-sync-selected-features")
        XCTAssertTrue(message.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(message).contains("마지막 동기화"), app.debugDescription)
        XCTAssertTrue(categories.exists && !UITestConditions.text(categories).isEmpty, app.debugDescription)
        XCTAssertTrue(node(app, "settings-calendar-sync-section").exists, app.debugDescription)
        let retry = node(app, "settings-sync-retry")
        FormUITestConditions.reveal(retry, in: app, scrollID: "settings-sync-status-scroll")
        XCTAssertTrue(retry.isHittable && retry.isEnabled, app.debugDescription)
        // Inspect the retry affordance without starting another HealthKit operation.
        XCTAssertTrue(node(app, "settings-sync-open-system-settings").exists, app.debugDescription)
    }

    @MainActor
    private func assertPanelsFollowMeasuredSpace(
        _ app: XCUIApplication,
        phase: String,
        expectsStacked: Bool = false,
    ) throws {
        let layout = node(app, "settings-sync-status-layout")
        let primary = node(app, "settings-sync-status-layout-primary")
        let secondary = node(app, "settings-sync-status-layout-secondary")
        XCTAssertTrue(layout.exists && primary.exists && secondary.exists, app.debugDescription)
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings")
        let rightRail = navigation.toolbar.frame.height > navigation.toolbar.frame.width
        if !rightRail {
            try NavigationUITestConditions.contentAboveBar(
                app,
                scrollID: "settings-sync-status-scroll",
                contentID: "settings-sync-status-layout-secondary",
                navigationID: "navigation-tab-settings",
            )
        }
        let first = primary.frame
        let second = secondary.frame
        let sideBySide = abs(first.minY - second.minY) <= 1 && first.maxX <= second.minX + 1
        let stacked = abs(first.minX - second.minX) <= 1 && first.maxY <= second.minY + 1
        XCTAssertTrue(sideBySide || stacked, "\(phase) panels must not overlap: \(first), \(second)")
        if expectsStacked {
            XCTAssertTrue(stacked, "Large text must use one readable column")
        }

        if rightRail {
            XCTAssertLessThanOrEqual(
                max(first.maxX, second.maxX),
                navigation.toolbar.frame.minX + 1,
                "Screen panels must stay clear of the right navigation lane",
            )
        }
        assertPanelsAvoidNativeReservations(app, primary: first, secondary: second, phase: phase)
    }

    /// React Native exposes a checkbox's checked state through its accessibility value on iOS.
    @MainActor
    private func checkboxIsChecked(_ element: XCUIElement) -> Bool {
        let value = (element.value as? String)?.lowercased() ?? ""
        XCTAssertTrue(
            value.contains("checked") || value.contains("unchecked"),
            "Checkbox value must expose its checked state: \(element.debugDescription)",
        )
        return value.contains("checked") && !value.contains("unchecked")
    }

    @MainActor
    private func assertPanelsAvoidNativeReservations(
        _ app: XCUIApplication,
        primary: CGRect,
        secondary: CGRect,
        phase: String,
    ) {
        let report = NavigationUITestConditions.observationSnapshot(
            app,
            testCase: self,
            attachmentName: "sync-status-\(phase)-native-geometry",
        )
        guard let geometry = report?["windowGeometry"] as? [String: Any],
              let regions = geometry["reservedRegions"] as? [[String: Any]]
        else {
            XCTFail("Native usable-region geometry must be observable")
            return
        }
        for region in regions where region["isActive"] as? Bool == true {
            guard let frame = region["frame"] as? [String: Double],
                  let x = frame["x"], let y = frame["y"],
                  let width = frame["width"], let height = frame["height"]
            else {
                XCTFail("Active native region frames must be complete")
                continue
            }
            let reserved = CGRect(x: x, y: y, width: width, height: height)
            XCTAssertFalse(primary.intersects(reserved), "Primary content crosses a native reserved region")
            XCTAssertFalse(secondary.intersects(reserved), "Recovery controls cross a native reserved region")
        }
    }

    @MainActor
    private func waitForWindowWidthChange(_ app: XCUIApplication, from width: CGFloat) {
        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let frame = app.windows.firstMatch.frame
                return abs(frame.width - width) > 0.5 && frame.width > frame.height
            },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed, app.debugDescription)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let control = node(app, identifier)
        XCTAssertTrue(control.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(control, in: app)
        control.tap()
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }

    @MainActor
    private func launchArguments(largeText: Bool) -> [String] {
        var arguments = [
            "-OROT_TEST_SCENARIO", "blood-pressure",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        if largeText {
            arguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        return arguments + AppearanceUITestConditions.observationArguments
    }
}
