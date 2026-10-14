import XCTest

/// Observes native keyboard geometry at the original large-text boundary; this fixture requests no record or provider access.
final class KeyboardSafeAreaUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testKoreanPrimaryActionRemainsReachableWithLargeTextAndKeyboardOpen() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "safe-area",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        defer { app.terminate() }
        let largeText = node(app, "safe-area-large-text-state")
        XCTAssertTrue(UITestConditions.exists(largeText))
        XCTAssertEqual(largeText.label, "큰 글자 사용 중")
        let root = node(app, "safe-area-root")
        let scroll = node(app, "safe-area-scroll")
        XCTAssertTrue(UITestConditions.exists(root))
        XCTAssertTrue(UITestConditions.exists(scroll))
        let viewport = scroll.frame
        XCTAssertGreaterThanOrEqual(viewport.minY - root.frame.minY, 44)
        XCTAssertGreaterThanOrEqual(root.frame.maxY - viewport.maxY, 20)
        let input = node(app, "safe-area-keyboard-input")
        XCTAssertEqual(input.label, "메모 입력")
        XCTAssertTrue(input.isHittable)
        input.tap()
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch))
        try keyboardOccludesViewport(app, viewport: viewport)
        let action = node(app, "safe-area-keyboard-action")
        XCTAssertTrue(UITestConditions.exists(action))
        XCTAssertEqual(action.label, "계속")
        XCTAssertFalse(app.buttons["Continue"].exists)
        // Before scrolling, the primary action must genuinely be outside the visible content above the keyboard.
        XCTAssertFalse(visibleAboveKeyboard(action, app: app, viewport: viewport))
        for attempt in 0 ... 16 {
            if visibleAboveKeyboard(action, app: app, viewport: viewport) {
                break
            }
            if attempt == 16 {
                XCTFail("Primary action never reached the measured keyboard viewport")
                return
            }
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        try keyboardOccludesViewport(app, viewport: viewport)
        action.tap()
        let completed = node(app, "safe-area-keyboard-action-done")
        XCTAssertTrue(UITestConditions.exists(completed))
        XCTAssertEqual(UITestConditions.text(completed), "완료")
        XCTAssertTrue(visibleAboveKeyboard(completed, app: app, viewport: viewport))
        try keyboardOccludesViewport(app, viewport: viewport)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "large-text-keyboard-primary-action-completed"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func visibleAboveKeyboard(_ element: XCUIElement, app: XCUIApplication, viewport: CGRect) -> Bool {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists, element.exists, element.isHittable, !element.frame.isEmpty else { return false }
        return element.frame.minY >= viewport.minY && element.frame.maxY <= min(viewport.maxY, keyboard.frame.minY)
    }

    @MainActor
    private func keyboardOccludesViewport(_ app: XCUIApplication, viewport: CGRect) throws {
        let visible = node(app, "safe-area-keyboard-visible")
        XCTAssertTrue(UITestConditions.exists(visible))
        let parts = visible.label.split(separator: ":")
        XCTAssertEqual(parts.count, 3, visible.debugDescription)
        guard parts.count == 3 else { return }
        XCTAssertEqual(parts[0], "keyboard-visible")
        let top = try XCTUnwrap(Double(parts[1]))
        let height = try XCTUnwrap(Double(parts[2]))
        XCTAssertGreaterThan(height, 0)
        XCTAssertGreaterThan(max(0, min(viewport.maxY, top) - viewport.minY), 0)
        let occlusion = max(0, min(viewport.maxY, top + height) - max(viewport.minY, top))
        XCTAssertGreaterThanOrEqual(occlusion, viewport.height * 0.25)
    }
}
