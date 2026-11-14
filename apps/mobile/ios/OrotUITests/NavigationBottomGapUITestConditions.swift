import XCTest

/// Measures real long-content bounds; short pages cannot establish excess scroll-bottom padding.
@MainActor
enum NavigationBottomGapUITestConditions {
    static func assertLongHomeBottom(_ app: XCUIApplication, testCase: XCTestCase) throws {
        let scroll = UITestConditions.element(app, "navigation-route-scroll").frame
        let content = UITestConditions.element(app, "overview-screen").frame
        let region = UITestConditions.element(app, "navigation-content-region").frame
        let navigation = try NavigationUITestConditions.navigationAction(app, "navigation-tab-overview").toolbar.frame
        let window = app.frame
        let keyboardExists = app.keyboards.firstMatch.exists
        let rail = navigation.height > navigation.width && navigation.minX >= region.maxX - 1
        let overlayElement = UITestConditions.element(app, "navigation-action-bar-overlay")
        let overlayExists = overlayElement.exists
        let observation = XCTAttachment(string: "sideRail=\(rail), actionOverlayExists=\(overlayExists), keyboardExists=\(keyboardExists)")
        observation.name = "Bottom action overlay presence"
        observation.lifetime = .keepAlways
        testCase.add(observation)
        // A side rail intentionally omits this bottom-only AX element. Never query its frame
        // when absent; zero denotes an observed absence, not a fabricated measured rectangle.
        guard rail || overlayExists else {
            XCTFail("Bottom navigation must expose its action overlay")
            return
        }
        let overlay = overlayExists ? overlayElement.frame : CGRect.zero
        let safe = try NavigationUITestConditions.safeArea(app, testCase: testCase)
        try NavigationUITestConditions.panelSnapshot(app, frames: [
            "window": window, "nativeSafeAreaRoot": safe.frame,
            "contentRegion": region, "scrollViewport": scroll, "longHomeContent": content,
            "actionOverlay": overlay, "nativeNavigation": navigation,
        ], testCase: testCase)
        // The whole Home view includes its internal 16pt padding. The outer scroller adds
        // the shared 16pt gap and the greater of system clearance or real action overlap.
        XCTAssertFalse(scroll.isEmpty || content.isEmpty || region.isEmpty || navigation.isEmpty)
        XCTAssertGreaterThan(content.height, scroll.height, "Long content is required; clipped AX frames cannot prove bottom padding")
        XCTAssertLessThanOrEqual(content.minY, scroll.minY)
        XCTAssertEqual(scroll.maxY, region.maxY, accuracy: 1)
        let overlap = max(0, min(scroll.maxY, overlay.maxY) - max(scroll.minY, overlay.minY))
        if rail {
            XCTAssertEqual(overlap, 0, accuracy: 1, "A side rail must not create a bottom overlay")
            XCTAssertEqual(scroll.maxY - content.maxY, safe.bottom + 16, accuracy: 1, "Unexpected bottom band beside the rail")
        } else {
            XCTAssertEqual(scroll.maxY - content.maxY, max(overlap, safe.bottom) + 16, accuracy: 1, "Reserve only the measured bottom action and shared gap")
        }
        // This Home observation has no keyboard or modal owner. Bind the listener to the
        // actual app root before requiring the viewport to fill, not merely fit, the physical bottom while preserving end-item clearance.
        XCTAssertFalse(keyboardExists, "Home bottom geometry requires a dismissed keyboard")
        XCTAssertEqual(safe.frame.minX, window.minX, accuracy: 1)
        XCTAssertEqual(safe.frame.minY, window.minY, accuracy: 1)
        XCTAssertEqual(safe.frame.width, window.width, accuracy: 1)
        XCTAssertEqual(safe.frame.height, window.height, accuracy: 1)
        XCTAssertEqual(scroll.maxY, safe.frame.maxY, accuracy: 1, "Scrolling pixels must reach the physical bottom")
        XCTAssertLessThanOrEqual(content.maxY, safe.frame.maxY - safe.bottom, "The last item must remain clear of the home indicator")
    }
}
