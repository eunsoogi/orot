import XCTest

/// Keep root and nested-section observations separate while using the same native geometry oracle.
@MainActor
extension NavigationGeometryUITestConditions {
    /// Verifies the actual four roots and returns Overview's measured UIWindow frame for contextual comparison.
    static func verifyRootBoundaries(_ app: XCUIApplication, testCase: XCTestCase) throws -> CGRect {
        _ = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "right-rail-native-geometry")
        let roots = [("conversation", ["rag-conversation-screen"]), ("overview", ["overview-title"]),
                     ("records", ["records-title"]), ("settings", ["settings-title"])]
        var homeFrame: CGRect?
        for (tab, markers) in roots {
            try NavigationUITestConditions.openTab(app, tab, markers: markers)
            try verifyRootSelection(app, tab: tab, testCase: testCase)
            let measuredFrame = try captureBoundary(app, navigationID: "navigation-tab-\(tab)", name: "duo-root-\(tab)-boundary", testCase: testCase)
            if tab == "overview" {
                homeFrame = measuredFrame
            }
        }
        try verifyScheduleSectionBoundary(app, rootFrame: XCTUnwrap(homeFrame), testCase: testCase)
        try NavigationUITestConditions.openTab(app, "overview", markers: ["overview-title"])
        return try XCTUnwrap(homeFrame)
    }

    /// Preserve every selected-root indicator assertion, including while Schedule owns the content.
    private static func verifyRootSelection(_ app: XCUIApplication, tab: String, testCase: XCTestCase) throws {
        let selected = try NavigationUITestConditions.navigationAction(app, "navigation-tab-\(tab)").control
        XCTAssertTrue(selected.isSelected)
        let indicator = UITestConditions.element(app, "navigation-root-selection-indicator").frame
        XCTAssertEqual(indicator.width, indicator.height, accuracy: 0.5)
        XCTAssertEqual(indicator.midX, selected.frame.midX, accuracy: 0.5)
        XCTAssertEqual(indicator.midY, selected.frame.midY, accuracy: 0.5)
        try NavigationUITestConditions.panelSnapshot(app, frames: ["selection": indicator, "selectedControl": selected.frame], testCase: testCase)
    }

    /// Schedule participates in the same measured rail as other Records stack destinations.
    private static func verifyScheduleSectionBoundary(_ app: XCUIApplication, rootFrame: CGRect, testCase: XCTestCase) throws {
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let schedule = UITestConditions.element(app, "records-open-schedule")
        _ = try XCTUnwrap(FormUITestConditions.reveal(schedule, in: app, scrollID: "navigation-route-scroll"))
        XCTAssertTrue(schedule.isEnabled && schedule.isHittable)
        let menuBefore = schedule.frame
        schedule.tap()
        NavigationUITestConditions.route(app, markers: ["calendar-title", "schedule-retry"])
        XCTAssertFalse(UITestConditions.element(app, "records-section-tabs").exists)
        let scheduleFrame = try captureBoundary(app, navigationID: "navigation-back", name: "duo-schedule-section-boundary", testCase: testCase)
        assertSameRailCenter(rootFrame, contextualFrames: [scheduleFrame])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
        XCTAssertEqual(schedule.frame.minY, menuBefore.minY, accuracy: 1)
        try verifyRootSelection(app, tab: "records", testCase: testCase)
    }
}
