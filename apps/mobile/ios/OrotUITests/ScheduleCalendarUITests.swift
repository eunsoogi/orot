import XCTest

/// Exercises synthetic event selection, confirmation-panel layout, appearance and large-text behavior.
final class ScheduleCalendarUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testSelectedAppointmentSurvivesDarkLandscapeReflowAndConfirmation() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = launch()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance {
                do {
                    try AppearanceUITestConditions.restore(
                        originalAppearance,
                        returningTo: app,
                        testCase: self,
                    )
                } catch {
                    XCTFail("Could not restore the original appearance: \(error)")
                }
            }
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }

        try openSchedule(app)
        let selectedTitle = try selectSyntheticEvent(app)
        UITestConditions.value(selectedTitle, equals: "합성 외래 방문")
        let portraitFrame = app.frame
        let portraitLayout = try ScheduleCalendarAdaptiveLayoutUITestConditions.waitForLayout(
            app,
            afterWidth: nil,
        )
        ScheduleCalendarAdaptiveLayoutUITestConditions.assertPanelFramesFit(
            app,
            layout: portraitLayout,
            file: #filePath,
            line: #line,
        )

        _ = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )
        UITestConditions.value(selectedTitle, equals: "합성 외래 방문")
        let confirmationPanel = UITestConditions.element(
            app,
            "schedule-adaptive-columns-secondary",
        )
        let confirm = UITestConditions.element(app, "calendar-confirm-selected")

        let landscapeFrame = try ScheduleCalendarAdaptiveLayoutUITestConditions.changeOrientation(
            app,
            to: .landscapeLeft,
            after: portraitFrame,
        )
        XCTAssertGreaterThan(landscapeFrame.width, landscapeFrame.height)
        UITestConditions.value(selectedTitle, equals: "합성 외래 방문")
        let landscapeLayout = try ScheduleCalendarAdaptiveLayoutUITestConditions.waitForLayout(
            app,
            afterWidth: portraitLayout.width,
        )
        ScheduleCalendarAdaptiveLayoutUITestConditions.assertPanelFramesFit(
            app,
            layout: landscapeLayout,
            file: #filePath,
            line: #line,
        )
        XCTAssertTrue(confirmationPanel.frame.contains(selectedTitle.frame), app.debugDescription)
        XCTAssertTrue(confirmationPanel.frame.contains(confirm.frame), app.debugDescription)

        FormUITestConditions.reveal(confirm, in: app, scrollID: "calendar-screen")
        XCTAssertTrue(confirm.isHittable, app.debugDescription)
        confirm.tap()

        let savedTitle = UITestConditions.element(app, "schedule-next-visit-title")
        UITestConditions.value(savedTitle, equals: "합성 외래 방문")
        XCTAssertFalse(UITestConditions.element(app, "calendar-confirm-selected").exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "schedule-confirmed-appointment-landscape-dark"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let portraitAfterSave = try ScheduleCalendarAdaptiveLayoutUITestConditions.changeOrientation(
            app,
            to: .portrait,
            after: landscapeFrame,
        )
        XCTAssertGreaterThan(portraitAfterSave.height, portraitAfterSave.width)
        let savedLayout = try ScheduleCalendarAdaptiveLayoutUITestConditions.waitForLayout(
            app,
            afterWidth: landscapeLayout.width,
        )
        ScheduleCalendarAdaptiveLayoutUITestConditions.assertPanelFramesFit(
            app,
            layout: savedLayout,
            file: #filePath,
            line: #line,
        )
        FormUITestConditions.reveal(
            savedTitle,
            in: app,
            scrollID: "calendar-screen",
        )
        XCTAssertTrue(savedTitle.isHittable, app.debugDescription)
    }

    @MainActor
    func testLargeTextKeepsScheduleConfirmationReachable() throws {
        XCUIDevice.shared.orientation = .portrait
        let normalApp = launch()
        try openSchedule(normalApp)
        let normalTitleHeight = UITestConditions.element(
            normalApp,
            "calendar-title",
        ).frame.height
        normalApp.terminate()

        let app = launch([
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ])
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let originalAppearance {
                do {
                    try AppearanceUITestConditions.restore(
                        originalAppearance,
                        returningTo: app,
                        testCase: self,
                    )
                } catch {
                    XCTFail("Could not restore the original appearance: \(error)")
                }
            }
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        _ = try AppearanceUITestConditions.select(
            false,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )

        try openSchedule(app)
        let title = UITestConditions.element(app, "calendar-title")
        XCTAssertGreaterThan(title.frame.height, normalTitleHeight)
        let selectedTitle = try selectSyntheticEvent(app)
        UITestConditions.value(selectedTitle, equals: "합성 외래 방문")
        let layout = try ScheduleCalendarAdaptiveLayoutUITestConditions.waitForLayout(
            app,
            afterWidth: nil,
        )
        ScheduleCalendarAdaptiveLayoutUITestConditions.assertPanelFramesFit(
            app,
            layout: layout,
            file: #filePath,
            line: #line,
        )

        let confirm = UITestConditions.element(app, "calendar-confirm-selected")
        FormUITestConditions.reveal(confirm, in: app, scrollID: "calendar-screen")
        XCTAssertTrue(confirm.isHittable, app.debugDescription)
        confirm.tap()

        let savedTitle = UITestConditions.element(app, "schedule-next-visit-title")
        UITestConditions.value(savedTitle, equals: "합성 외래 방문")
        FormUITestConditions.reveal(
            savedTitle,
            in: app,
            scrollID: "calendar-screen",
        )
        XCTAssertTrue(savedTitle.isHittable, app.debugDescription)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "schedule-confirmed-appointment-accessibility-xxxl"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    private func launch(_ extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "calendar",
            "-OROT_CALENDAR_PROBE", "synthetic",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + AppearanceUITestConditions.observationArguments + extraArguments
        app.launch()
        return app
    }

    @MainActor
    private func openSchedule(_ app: XCUIApplication) throws {
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "welcome-title")))
        try NavigationUITestConditions.openTab(
            app,
            "schedule",
            markers: ["calendar-title"],
        )
        UITestConditions.value(
            UITestConditions.element(app, "calendar-title"),
            equals: "일정",
        )
    }

    @MainActor
    private func selectSyntheticEvent(_ app: XCUIApplication) throws -> XCUIElement {
        let month = UITestConditions.element(app, "calendar-month-title")
        UITestConditions.value(month, equals: "2035년 6월")
        FormUITestConditions.reveal(month, in: app, scrollID: "calendar-screen")
        let day = UITestConditions.element(app, "calendar-day-2035-06-02")
        FormUITestConditions.reveal(day, in: app, scrollID: "calendar-screen")
        day.tap()

        let candidate = UITestConditions.element(
            app,
            "calendar-candidate-calendar-synthetic-clinic",
        )
        XCTAssertTrue(candidate.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(
            candidate,
            in: app,
            scrollID: "calendar-screen",
        )
        candidate.tap()

        let title = UITestConditions.element(app, "calendar-selected-event-title")
        UITestConditions.value(title, equals: "합성 외래 방문")
        let confirmationPanel = UITestConditions.element(
            app,
            "schedule-adaptive-columns-secondary",
        )
        let confirm = UITestConditions.element(app, "calendar-confirm-selected")
        XCTAssertTrue(confirmationPanel.frame.contains(title.frame), app.debugDescription)
        XCTAssertTrue(confirmationPanel.frame.contains(confirm.frame), app.debugDescription)
        return title
    }
}
