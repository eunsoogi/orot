import XCTest

/// Exercises direct and overflow actions without treating a floating control as scroll content.
@MainActor
enum NavigationPageActionUITestConditions {
    /// Exercise actual root buttons, starting with Schedule from Home, at their accessibility activation points.
    static func verifyDirectRecordsTap(_ app: XCUIApplication) throws {
        for (tab, markers) in [("schedule", ["calendar-title", "schedule-retry"]), ("records", ["records-title"])] {
            let identifier = "navigation-tab-\(tab)"
            let control = try NavigationUITestConditions.navigationAction(app, identifier).control
            XCTAssertEqual(app.buttons.matching(identifier: identifier).count, 1, app.debugDescription)
            guard control.isEnabled, control.isHittable else { XCTFail("\(tab) must be enabled and directly hittable: \(app.debugDescription)"); throw NSError(domain: "NavigationUITests", code: 6) }
            control.tap()
            NavigationUITestConditions.route(app, markers: markers)
            XCTAssertTrue(control.isSelected, "Direct tap must select \(tab)")
            if tab == "schedule" {
                try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
            }
        }
    }

    /// Select a hidden root destination through the actual More menu, preserving direct-tab checks.
    static func openOverflowTab(_ app: XCUIApplication, tab: String) throws -> Bool {
        let direct = app.buttons["navigation-tab-\(tab)"]
        let more = app.buttons["navigation-page-action-overflow"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in direct.exists || more.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, app.debugDescription)
        if direct.exists {
            return false
        }
        guard more.exists else { throw NSError(domain: "NavigationUITests", code: 4, userInfo: [NSLocalizedDescriptionKey: "Neither tab nor More exists: \(tab)"]) }
        XCTAssertTrue(more.isHittable, app.debugDescription)
        more.tap()
        let labels = ["home": "홈 탭", "records": "기록 탭", "schedule": "일정 탭", "ai": "AI 탭", "settings": "설정 탭"]
        let item = try app.buttons[XCTUnwrap(labels[tab])]
        XCTAssertTrue(item.exists && item.isHittable, app.debugDescription)
        item.tap()
        return true
    }

    /// A failing schedule still exposes its primary retry directly beside the selected tab.
    static func assertSelectedRoot(_ app: XCUIApplication, action: XCUIElement, tab: String) {
        XCTAssertTrue(action.isSelected, "Root tab \(tab) must expose selected state")
        if tab == "schedule", app.buttons["schedule-retry"].exists {
            assertRootRetryOverflow(app)
        }
    }

    static func assertRootRetryOverflow(_ app: XCUIApplication) {
        let retry = app.buttons["schedule-retry"], selected = app.buttons["navigation-tab-schedule"], more = app.buttons["navigation-page-action-overflow"]
        XCTAssertTrue(retry.exists && retry.isHittable && retry.frame.width >= 88, app.debugDescription)
        XCTAssertTrue(selected.exists && selected.isSelected && selected.isHittable, app.debugDescription)
        XCTAssertTrue(more.exists && more.isHittable, app.debugDescription)
        XCTAssertEqual(retry.frame.midY, selected.frame.midY, accuracy: 1)
        XCTAssertFalse(retry.frame.intersects(selected.frame))
        XCTAssertFalse(retry.frame.intersects(more.frame))
    }

    static func assertDirectPrimary(_ app: XCUIApplication, id: String) {
        let primary = UITestConditions.element(app, id)
        XCTAssertTrue(primary.exists && primary.isHittable, "Primary action must be directly reachable before opening More")
    }

    /// Preserve each observed predicate so a keyboard or hit-test failure is distinguishable.
    static func keyboardActionReady(_ action: XCUIElement, keyboard: XCUIElement, app: XCUIApplication, testCase: XCTestCase) -> Bool {
        let exists = action.exists
        let hittable = exists && action.isHittable
        let keyboardExists = keyboard.exists
        XCTContext.runActivity(named: "Keyboard action state") { activity in
            let state = "actionExists=\(exists), actionHittable=\(hittable), actionEnabled=\(exists && action.isEnabled), actionFrame=\(exists ? String(describing: action.frame) : "missing"), keyboardExists=\(keyboardExists), keyboardFrame=\(keyboardExists ? String(describing: keyboard.frame) : "missing")"
            let attachment = XCTAttachment(string: state)
            attachment.name = "keyboard-action-state"
            attachment.lifetime = .keepAlways
            activity.add(attachment)
        }
        if !exists || !hittable || !keyboardExists {
            _ = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "keyboard-action-failure-native")
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "keyboard-action-failure-screen"
            screenshot.lifetime = .keepAlways
            testCase.add(screenshot)
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "keyboard-action-failure-hierarchy"
            hierarchy.lifetime = .keepAlways
            testCase.add(hierarchy)
        }
        return exists && hittable && keyboardExists
    }

    /// Check real target frames in an already-open, standard-text detail route.
    static func assertSingleBottomRow(_ app: XCUIApplication, ids: [String], minimumWidths: [CGFloat], disabledIDs: Set<String>) {
        XCTAssertEqual(ids.count, minimumWidths.count)
        let buttons = ids.map { UITestConditions.element(app, $0) }
        for (button, minimumWidth) in zip(buttons, minimumWidths) {
            XCTAssertTrue(UITestConditions.exists(button), app.debugDescription)
            XCTAssertGreaterThanOrEqual(button.frame.width, minimumWidth)
            XCTAssertGreaterThanOrEqual(button.frame.height, 48)
            XCTAssertTrue(app.frame.contains(button.frame), app.debugDescription)
        }
        guard let first = buttons.first else { return }
        for (index, button) in buttons.enumerated() {
            XCTAssertEqual(button.frame.midY, first.frame.midY, accuracy: 1)
            for other in buttons.dropFirst(index + 1) {
                XCTAssertFalse(button.frame.intersects(other.frame), app.debugDescription)
            }
        }
        for button in buttons where !disabledIDs.contains(button.identifier) {
            XCTAssertTrue(button.isHittable, app.debugDescription)
        }
        for button in buttons where disabledIDs.contains(button.identifier) {
            XCTAssertFalse(button.isEnabled, app.debugDescription)
        }
    }

    static func pageAction(_ app: XCUIApplication, id: String, label: String) -> XCUIElement {
        let direct = UITestConditions.element(app, id)
        let overflow = UITestConditions.element(app, "navigation-page-action-overflow")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in direct.exists || overflow.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        if direct.exists {
            return direct
        }
        XCTAssertTrue(overflow.exists && overflow.isHittable, app.debugDescription)
        overflow.tap()
        let item = app.buttons[label]
        XCTAssertTrue(UITestConditions.exists(item), app.debugDescription)
        return item
    }

    static func tap(_ app: XCUIApplication, id: String, label: String) {
        let target = pageAction(app, id: id, label: label)
        XCTAssertTrue(target.exists && target.isHittable, app.debugDescription)
        target.tap()
    }

    /// Validate actual native frames and hit testing before selecting any menu item.
    static func assertToolbar(_ app: XCUIApplication, marker: String, actions: [String]) {
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, marker)), app.debugDescription)
        let toolbar = UITestConditions.element(app, "navigation-page-action-toolbar")
        XCTAssertTrue(UITestConditions.exists(toolbar), app.debugDescription)
        let visible = actions.map { UITestConditions.element(app, $0) }
        for button in visible {
            XCTAssertTrue(UITestConditions.exists(button) && button.isHittable && toolbar.frame.contains(button.frame) && app.frame.contains(button.frame), app.debugDescription)
        }
        for (index, button) in visible.enumerated() {
            for other in visible.dropFirst(index + 1) {
                XCTAssertFalse(button.frame.intersects(other.frame), app.debugDescription)
            }
        }
    }

    /// On a Duo rail, the actual page buttons must remain above navigation and inside the window.
    static func assertRailAboveNavigation(_ app: XCUIApplication, pageIDs: [String], sampledAfter: Double, testCase: XCTestCase) throws {
        let buttons = pageIDs.map { UITestConditions.element(app, $0) }.filter(\.exists)
        if !UITestConditions.element(app, "navigation-page-action-overflow").exists {
            XCTAssertTrue(UITestConditions.element(app, "manual-history-save").exists && UITestConditions.element(app, "manual-history-form-close").exists, app.debugDescription)
        }
        let back = UITestConditions.element(app, "navigation-back")
        let home = UITestConditions.element(app, "navigation-home")
        let keyboard = app.keyboards.firstMatch
        let content = UITestConditions.element(app, "navigation-content-region")
        let root = UITestConditions.element(app, "navigation-keyboard-avoiding-root")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "navigation-test-observation")), app.debugDescription)
        let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "page-rail-native-window")
        let geometry = try XCTUnwrap(snapshot?["windowGeometry"] as? [String: Any])
        let dock = try XCTUnwrap(geometry["dockControls"] as? [String: Any])
        let window = try rect(dock["windowBounds"])
        let sampleStart = try XCTUnwrap(dock["sampleStartedAtMs"] as? Double)
        let sampleEnd = try XCTUnwrap(dock["sampleEndedAtMs"] as? Double)
        let windowID = try XCTUnwrap(dock["windowID"] as? String)
        let controls = try XCTUnwrap(dock["controls"] as? [[String: Any]])
        XCTAssertGreaterThan(sampleStart, sampledAfter)
        XCTAssertGreaterThanOrEqual(sampleEnd, sampleStart)
        XCTAssertLessThanOrEqual(sampleEnd, Date().timeIntervalSince1970 * 1000)
        XCTAssertNotNil(snapshot?["observerID"] as? String)
        XCTAssertEqual(dock["status"] as? String, "available")
        XCTAssertEqual(dock["visibleKeyWindowCount"] as? Int, 1)
        XCTAssertEqual(dock["truncated"] as? Bool, false)
        XCTAssertNotNil(dock["sceneID"] as? String)
        XCTAssertNotNil(dock["screenID"] as? String)
        XCTAssertEqual(dock["screenCoordinateSpace"] as? String, "UIKit-screen-base")
        XCTAssertEqual(dock["sceneCoordinateSpace"] as? String, "UIWindowScene.coordinateSpace")
        XCTAssertEqual(dock["orientation"] as? Int, geometry["sceneOrientation"] as? Int)
        for key in ["windowFrameInScene", "windowFrameInScreen"] {
            try assertSameRect(rect(dock[key]), window)
        }
        try assertSameRect(rect(geometry["windowBounds"]), window)
        let axReadStart = Date().timeIntervalSince1970 * 1000
        XCTAssertLessThanOrEqual(sampleEnd, axReadStart)
        for target in buttons + [back, home] {
            let matches = controls.filter { $0["identifier"] as? String == target.identifier }
            XCTAssertEqual(matches.count, 1, app.debugDescription)
            let control = try XCTUnwrap(matches.first)
            XCTAssertEqual(control["windowID"] as? String, windowID)
            XCTAssertEqual(control["sameWindow"] as? Bool, true)
            XCTAssertEqual(control["ancestorComplete"] as? Bool, true)
            XCTAssertEqual(control["hidden"] as? Bool, false)
            XCTAssertEqual(control["enabled"] as? Bool, true)
            XCTAssertEqual(control["isAccessibilityElement"] as? Bool, true)
            XCTAssertNotNil(control["controlID"] as? String)
            XCTAssertNotNil(control["hostID"] as? String)
            XCTAssertEqual(control["hostRole"] as? String, target.identifier.hasPrefix("navigation-") && target.identifier != "navigation-page-action-overflow" ? "navigation" : "page")
            let axWindows = app.windows.allElementsBoundByIndex.filter { $0.descendants(matching: .any).matching(identifier: target.identifier).count > 0 }
            XCTAssertEqual(axWindows.count, 1, app.debugDescription)
            if let axWindow = axWindows.first {
                try assertSameRect(axWindow.frame, rect(dock["windowFrameInScreen"]))
            }
            for key in ["nativeFrameInWindow", "accessibilityFrameInWindow", "accessibilityFrameInScreen", "frameInScene"] {
                let measured = try rect(control[key])
                XCTAssertEqual(measured.minX, target.frame.minX, accuracy: 0.5)
                XCTAssertEqual(measured.minY, target.frame.minY, accuracy: 0.5)
                XCTAssertEqual(measured.width, target.frame.width, accuracy: 0.5)
                XCTAssertEqual(measured.height, target.frame.height, accuracy: 0.5)
            }
        }
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince1970 * 1000, axReadStart)
        XCTAssertFalse(buttons.isEmpty, app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(back) && back.isHittable && UITestConditions.exists(home) && home.isHittable, app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(content) && !content.frame.isEmpty, app.debugDescription)
        XCTAssertTrue(root.exists && !window.isEmpty, app.debugDescription)
        XCTAssertEqual(root.frame.minX, window.minX, accuracy: 0.5)
        XCTAssertEqual(root.frame.minY, window.minY, accuracy: 0.5)
        XCTAssertEqual(root.frame.width, window.width, accuracy: 0.5)
        XCTAssertEqual(root.frame.height, window.height, accuracy: 0.5)
        XCTAssertTrue(keyboard.exists && window.intersects(keyboard.frame), app.debugDescription)
        for button in buttons {
            XCTAssertTrue(button.isHittable && window.contains(button.frame), app.debugDescription)
            XCTAssertFalse(button.frame.intersects(content.frame), app.debugDescription)
            XCTAssertLessThanOrEqual(button.frame.maxY, min(back.frame.minY, home.frame.minY), app.debugDescription)
            XCTAssertLessThanOrEqual(button.frame.maxY, keyboard.frame.minY, app.debugDescription)
        }
        for (index, button) in buttons.enumerated() {
            for other in buttons.dropFirst(index + 1) {
                XCTAssertFalse(button.frame.intersects(other.frame), app.debugDescription)
            }
        }
    }

    private static func rect(_ value: Any?) throws -> CGRect {
        let values = try XCTUnwrap(value as? [String: Double])
        return try CGRect(x: XCTUnwrap(values["x"]), y: XCTUnwrap(values["y"]), width: XCTUnwrap(values["width"]), height: XCTUnwrap(values["height"]))
    }

    private static func assertSameRect(_ first: CGRect, _ second: CGRect) {
        XCTAssertEqual(first.minX, second.minX, accuracy: 0.5)
        XCTAssertEqual(first.minY, second.minY, accuracy: 0.5)
        XCTAssertEqual(first.width, second.width, accuracy: 0.5)
        XCTAssertEqual(first.height, second.height, accuracy: 0.5)
    }
}
