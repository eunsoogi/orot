import XCTest

/// Measures real long-content bounds; short pages cannot establish excess scroll-bottom padding.
@MainActor
enum NavigationBottomGapUITestConditions {
    static func assertLongHomeBottom(_ app: XCUIApplication, testCase: XCTestCase) throws {
        let scroll = UITestConditions.element(app, "navigation-route-scroll").frame
        let content = UITestConditions.element(app, "overview-screen").frame
        let region = UITestConditions.element(app, "navigation-content-region").frame
        let overlay = UITestConditions.element(app, "navigation-action-bar-overlay").frame
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-overview").toolbar.frame
        let safe = try NavigationUITestConditions.safeArea(app, testCase: testCase)
        try NavigationUITestConditions.panelSnapshot(app, frames: [
            "window": app.frame, "nativeSafeAreaRoot": safe.frame,
            "contentRegion": region, "scrollViewport": scroll, "longHomeContent": content,
            "actionOverlay": overlay, "nativeNavigation": navigation,
        ], testCase: testCase)
        // The whole Home view includes its internal 16pt padding. The outer scroller adds only
        // the shared 16pt gap and real bottom-action overlap, not another absent-bar reservation.
        XCTAssertFalse(scroll.isEmpty || content.isEmpty || region.isEmpty || navigation.isEmpty)
        XCTAssertGreaterThan(content.height, scroll.height, "Long content is required; clipped AX frames cannot prove bottom padding")
        XCTAssertLessThanOrEqual(content.minY, scroll.minY)
        XCTAssertEqual(scroll.maxY, region.maxY, accuracy: 1)
        let overlap = max(0, min(scroll.maxY, overlay.maxY) - max(scroll.minY, overlay.minY))
        let rail = navigation.height > navigation.width && navigation.minX >= region.maxX - 1
        if rail {
            XCTAssertEqual(overlap, 0, accuracy: 1, "A side rail must not create a bottom overlay")
            XCTAssertEqual(scroll.maxY - content.maxY, 16, accuracy: 1, "Unexpected bottom band beside the rail")
        } else {
            XCTAssertEqual(scroll.maxY - content.maxY, overlap + 16, accuracy: 1, "Reserve only the measured bottom action and shared gap")
        }
        XCTAssertLessThanOrEqual(scroll.maxY, safe.frame.maxY - safe.bottom + 1)
    }
}
