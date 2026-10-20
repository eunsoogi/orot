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
        // Use the observed keyboard viewport and app-relative coordinates. Short
        // scroller-relative drags repeatedly resolve the same AX hierarchy during
        // event synthesis; the shared helper retains the original 16-gesture limit.
        FormUITestConditions.reveal(action, in: app, scroll: scroll)
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
    func testConversationOutputComposerAndSwipeUndoAcrossAppearances() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore Simulator appearance: \(error)") }
            }
            app.terminate()
        }
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
        for dark in [false, true] {
            _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
                if original == nil {
                    original = $0
                }
            })
            let suffix = dark ? "dark" : "light"
            node(app, "rag-conversation-new-session").tap()
            let field = node(app, "rag-conversation-composer-field")
            let baseline = field.frame.height
            let input = node(app, "rag-conversation-input")
            input.tap()
            input.typeText("complete synthetic\nsecond line\nthird line")
            let grows = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in field.frame.height > baseline + 10 }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [grows]), .completed)
            RecordingFixtureUITestConditions.capture(app, "conversation-multiline-\(suffix)", testCase: self)
            let initialSend = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
            XCTAssertTrue(UITestConditions.exists(initialSend))
            XCTAssertTrue(initialSend.isEnabled)
            XCTAssertEqual(initialSend.frame.width, 44, accuracy: 1)
            initialSend.tap()
            reopenConversation(app)
            let clearsHeight = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                abs(field.frame.height - 44) <= 1
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [clearsHeight]), .completed)
            let citation = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
            XCTAssertTrue(UITestConditions.exists(citation))
            let readable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                citation.isHittable && citation.frame.maxY <= self.node(app, "rag-conversation-composer").frame.minY
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [readable]), .completed)
            RecordingFixtureUITestConditions.capture(app, "conversation-completed-\(suffix)", testCase: self)
            citation.tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "ai-feature-source-detail")))
            try NavigationUITestConditions.tapNavigation(app, "navigation-back")
            XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
            node(app, "rag-conversation-new-session").tap()
            input.tap()
            input.typeText("pending synthetic")
            app.buttons.matching(identifier: "rag-conversation-send").firstMatch.tap()
            let stop = app.buttons.matching(identifier: "rag-conversation-cancel").firstMatch
            XCTAssertTrue(UITestConditions.exists(stop))
            // Leaving and reopening must retain the app-owned request and the current input state.
            let pendingRowID = reopenConversation(app)
            XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-stream")))
            let stopFrame = stop.frame
            RecordingFixtureUITestConditions.capture(app, "conversation-streaming-\(suffix)", testCase: self)
            stop.tap()
            let send = app.buttons.matching(identifier: "rag-conversation-send").firstMatch
            XCTAssertTrue(UITestConditions.exists(send))
            XCTAssertEqual(stopFrame.width, send.frame.width, accuracy: 1)
            XCTAssertEqual(stopFrame.midX, send.frame.midX, accuracy: 1)
            // Keyboard restoration can move the whole composer. Compare its actual bottom anchor,
            // rather than screen coordinates taken on opposite sides of that transition.
            let sameAnchor = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                abs(send.frame.maxY - field.frame.maxY) <= 1 && abs(send.frame.height - 44) <= 1
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [sameAnchor]), .completed)
            RecordingFixtureUITestConditions.capture(app, "conversation-cancelled-\(suffix)", testCase: self)
            node(app, "rag-conversation-sessions-toggle").tap()
            let row = node(app, pendingRowID)
            XCTAssertTrue(UITestConditions.exists(row))
            let rowID = row.identifier
            // Reveal the trailing action without committing the full-swipe shortcut yet.
            row.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
                .press(forDuration: 0.05, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.5)))
            let delete = app.buttons["삭제"].firstMatch
            XCTAssertTrue(UITestConditions.exists(delete))
            RecordingFixtureUITestConditions.capture(app, "conversation-delete-action-\(suffix)", testCase: self)
            delete.tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "conversation-history-undo")))
            XCTAssertFalse(node(app, rowID).exists)
            RecordingFixtureUITestConditions.capture(app, "conversation-deleted-\(suffix)", testCase: self)
            node(app, "conversation-history-undo").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, rowID)))
            RecordingFixtureUITestConditions.capture(app, "conversation-history-restored-\(suffix)", testCase: self)
            node(app, rowID).tap()
            node(app, "rag-conversation-new-session").tap()
            input.tap()
            input.typeText("failure synthetic")
            app.buttons.matching(identifier: "rag-conversation-send").firstMatch.tap()
            reopenConversation(app)
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요."].firstMatch))
            RecordingFixtureUITestConditions.capture(app, "conversation-failed-\(suffix)", testCase: self)
        }
    }

    /// Reopen the actual latest row and retain its identity independently of UIKit's grouped text labels.
    @MainActor
    @discardableResult
    private func reopenConversation(_ app: XCUIApplication) -> String {
        node(app, "rag-conversation-sessions-toggle").tap()
        let latest = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation-history-session-")).firstMatch
        XCTAssertTrue(UITestConditions.exists(latest))
        let identifier = latest.identifier
        latest.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
        return identifier
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
