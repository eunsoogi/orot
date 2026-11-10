import XCTest

/// Confirms the default conversation stays usable in the Duo lane at large text and in both appearances.
final class FeatureEntryDuoUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testFeatureEntryActionsStayWithinContentLaneAfterOrientationChange() throws {
        if ProcessInfo.processInfo.environment["OROT_TEST_EXTERNAL_DUO_OBSERVATION"] == "1" {
            try FeatureEntryDuoActionConditions.observeExternalTransition(testCase: self)
            return
        }
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "ai-feature-visit-questions",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ] + AppearanceUITestConditions.observationArguments
        // Compare the real UIKit window with the committed content and rail measurements.
        app.launchArguments += ["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        if ProcessInfo.processInfo.environment["OROT_TEST_DUO_MENU_DIAGNOSTIC"] == "1" {
            app.launchArguments += ["-OROT_TEST_MENU_PRESENTATION", "YES"]
        }
        app.launch()
        var originalAppearance: AppearanceUITestConditions.Snapshot?
        defer {
            XCUIDevice.shared.orientation = .portrait
            if let originalAppearance {
                do {
                    try AppearanceUITestConditions.restore(
                        originalAppearance,
                        returningTo: app,
                        testCase: self,
                    )
                } catch {
                    XCTFail("Could not restore the owned device appearance: \(error)")
                }
            }
            UITestConditions.terminateStandaloneApp(app)
        }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        _ = try AppearanceUITestConditions.select(
            false,
            returningTo: app,
            testCase: self,
            captureOriginal: { originalAppearance = $0 },
        )
        try NavigationUITestConditions.openTab(app, "ai", markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)

        let originalFrame = app.frame
        XCUIDevice.shared.orientation = .landscapeLeft
        let changedFrame = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let frame = app.frame
                return !frame.isEmpty && frame.width > frame.height &&
                    (abs(frame.width - originalFrame.width) > 0.5 || abs(frame.height - originalFrame.height) > 0.5)
            },
            object: nil,
        )
        XCTAssertEqual(UITestConditions.wait(for: [changedFrame]), .completed, "The active window must report the new orientation")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)

        _ = try AppearanceUITestConditions.select(
            true,
            returningTo: app,
            testCase: self,
            captureOriginal: {
                if originalAppearance == nil {
                    originalAppearance = $0
                }
            },
        )
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        try assertConversationFitsContentLane(app)
    }

    /// Measures the actual conversation lane and rail targets in each observed window state.
    @MainActor
    private func assertConversationFitsContentLane(_ app: XCUIApplication) throws {
        let viewport = node(app, "navigation-content-region")
        let rail = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").toolbar
        let screen = node(app, "rag-conversation-screen")
        let input = node(app, "rag-conversation-input")
        for element in [viewport, rail, screen, input] {
            XCTAssertTrue(UITestConditions.exists(element), app.debugDescription)
            XCTAssertFalse(element.frame.isEmpty, element.debugDescription)
        }
        let ai = try NavigationUITestConditions.navigationAction(app, "navigation-tab-ai").control
        XCTAssertTrue(rail.isHittable && ai.exists && ai.isHittable && ai.isSelected)
        XCTAssertGreaterThanOrEqual(ai.frame.width, 44)
        XCTAssertGreaterThanOrEqual(ai.frame.height, 44)
        XCTAssertTrue(rail.frame.insetBy(dx: -1, dy: -1).contains(ai.frame))
        let activeBars = app.descendants(matching: .any).matching(identifier: "navigation-root-tabs-glass-backdrop")
            .allElementsBoundByIndex.filter { $0.exists && $0.isHittable && $0.frame.insetBy(dx: -1, dy: -1).contains(ai.frame) }
        XCTAssertEqual(activeBars.count, 1, "The selected AI control must belong to one active root bar")
        try assertRightRailGeometry(app, viewport: viewport.frame, bar: rail.frame)
        XCTAssertLessThanOrEqual(viewport.frame.maxX, rail.frame.minX + 0.5, app.debugDescription)
        XCTAssertGreaterThanOrEqual(screen.frame.width, viewport.frame.width * 0.75, screen.debugDescription)
        XCTAssertGreaterThanOrEqual(input.frame.minX, viewport.frame.minX - 0.5)
        XCTAssertLessThanOrEqual(input.frame.maxX, viewport.frame.maxX + 0.5)
        XCTAssertTrue(input.isHittable, input.debugDescription)
        XCTAssertFalse(input.frame.intersects(rail.frame), input.debugDescription)

        // Context actions have their own native toolbar alongside the root-tab toolbar.
        let pageToolbar = node(app, "navigation-page-action-toolbar")
        XCTAssertTrue(UITestConditions.exists(pageToolbar), app.debugDescription)
        XCTAssertFalse(pageToolbar.frame.isEmpty, pageToolbar.debugDescription)
        try FeatureEntryDuoActionConditions.verify(app, toolbar: pageToolbar, viewport: viewport.frame)
        XCTAssertFalse(node(app, "ai-features-screen").exists)
        XCTAssertFalse(node(app, "external-evidence-search").exists)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
    }

    /// Exercises both page actions in portrait without treating an unchanged window as a rotation pass.
    @MainActor
    func testPortraitConversationActionsOpenHistoryAndStartNewSession() throws {
        if ProcessInfo.processInfo.environment["OROT_TEST_OPEN_DUO_FUNCTIONAL"] == "1" {
            try FeatureEntryDuoActionConditions.verifyOpenConversation(testCase: self)
            return
        }
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        if ProcessInfo.processInfo.environment["OROT_TEST_DUO_MENU_DIAGNOSTIC"] == "1" {
            app.launchArguments += ["-OROT_TEST_MENU_PRESENTATION", "YES", "-OROT_TEST_NAVIGATION_FOCUS_OBSERVATION", "YES"]
        }
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["rag-conversation-screen"])
        XCTAssertGreaterThan(app.frame.height, app.frame.width, "The portrait journey requires an observed portrait window")
        try assertConversationFitsContentLane(app)
        let input = node(app, "rag-conversation-input")
        XCTAssertTrue(input.isHittable)
        input.tap()
        input.typeText("history selection")
        if ProcessInfo.processInfo.environment["OROT_TEST_DUO_MENU_DIAGNOSTIC"] == "1" {
            try FoldedMenuDiagnostic.capture(app, testCase: self)
            throw XCTSkip("Folded keyboard More observation captured")
        }
        if ProcessInfo.processInfo.environment["OROT_TEST_DUO_KEYBOARD_DIAGNOSTIC"] == "1" {
            // Capture the real keyboard and controls before entering an action query that may have no target.
            let ids = ["navigation-tab-home", "navigation-home", "navigation-tab-ai", "navigation-page-action-overflow", "rag-conversation-sessions-toggle", "rag-conversation-new-session"]
            let states = ids.map { id in
                let matches = app.descendants(matching: .any).matching(identifier: id)
                let item = matches.firstMatch
                return "\(id): count=\(matches.count), exists=\(item.exists), enabled=\(item.exists && item.isEnabled), hittable=\(item.exists && item.isHittable), frame=\(item.exists ? String(describing: item.frame) : "missing")"
            }.joined(separator: "\n")
            let keyboard = app.keyboards.firstMatch
            let attachment = XCTAttachment(string: "\(states)\nkeyboardExists=\(keyboard.exists), keyboardFrame=\(keyboard.exists ? String(describing: keyboard.frame) : "missing"), appFrame=\(app.frame)")
            attachment.name = "duo-keyboard-navigation-state"
            attachment.lifetime = .keepAlways
            add(attachment)
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "duo-keyboard-navigation-hierarchy"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "duo-keyboard-navigation"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            _ = NavigationUITestConditions.observationSnapshot(app, testCase: self, attachmentName: "duo-keyboard-navigation-allocation")
            throw XCTSkip("Keyboard allocation diagnostic captured before feature actions")
        }
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        XCTAssertEqual(input.value as? String, "history selection")
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-new-session", label: "새 대화")
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        let newValue = try XCTUnwrap(input.value as? String, "The new composer must expose its value")
        XCTAssertFalse(newValue.contains("history selection"), "A new session must not retain the previous draft")
    }

    /// Compares the visible lane and native toolbar with independently sampled UIKit geometry.
    @MainActor
    private func assertRightRailGeometry(_ app: XCUIApplication, viewport: CGRect, bar: CGRect) throws {
        typealias Matcher = NavigationGeometryReservedRegionMatcher
        let report = try XCTUnwrap(NavigationUITestConditions.observationSnapshot(
            app, testCase: self, attachmentName: "duo-entry-native-geometry",
        ))
        let reference = try XCTUnwrap(report["windowGeometry"] as? [String: Any])
        let lifecycle = try XCTUnwrap(report["lifecycle"] as? [[String: Any]])
        let native = try XCTUnwrap(lifecycle.last { $0["event"] as? String == "window-geometry-context" })
        let shared = try XCTUnwrap(lifecycle.last { $0["event"] as? String == "navigation-content-frame" })
        let contextJSON = try XCTUnwrap(native["normalizedSnapshot"] as? String)
        let frameJSON = try XCTUnwrap(shared["frame"] as? String)
        let context = try JSONDecoder().decode(NavigationWindowGeometryUITestConditions.GeometrySnapshot.self, from: Data(contextJSON.utf8))
        let publicUIKit = try JSONDecoder().decode(Matcher.GeometryPayload.self, from: JSONSerialization.data(withJSONObject: reference))
        let frame = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(frameJSON.utf8)) as? [String: Any])
        let contextFields = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contextJSON.utf8)) as? [String: Any])
        let controls = try XCTUnwrap(reference["navigationControls"] as? [String: Any])
        XCTAssertEqual(controls["truncated"] as? Bool, false)
        let frames = try XCTUnwrap(controls["frames"] as? [[String: Any]])
        let rootFrames = frames.filter { $0["identifier"] as? String == "navigation-root-tabs-glass-backdrop" }
        XCTAssertEqual(rootFrames.count, 1)
        let nativeBar = try decodeRect(XCTUnwrap(rootFrames.first?["frame"]))
        let contextBar = try decodeRect(contextFields["navigationFrame"])
        XCTAssertEqual(contextFields["navigationSide"] as? String, "right")
        let available = try decodeRect(frame["availableContentFrame"])
        let navigation = try decodeRect(frame["navigationFrame"])
        XCTAssertTrue(context.payload.matches(publicUIKit), "Native context must match current UIKit window and reservations")
        XCTAssertTrue(Matcher.rectMatches(geometryRect(bar), nativeBar) && Matcher.rectMatches(geometryRect(bar), contextBar),
                      "The accessibility bar must match UIKit and context navigation frames")
        XCTAssertTrue(Matcher.rightRailMatches(
            window: publicUIKit.windowBounds, insets: publicUIKit.safeAreaInsets, usable: context.usableRegions,
            viewport: geometryRect(viewport), available: available, bar: geometryRect(bar),
            navigation: navigation, side: frame["side"] as? String ?? "",
        ), "The right rail and content lane must match their UIKit-backed geometry")
    }

    private func decodeRect(_ object: Any?) throws -> NavigationGeometryReservedRegionMatcher.GeometryRect {
        try JSONDecoder().decode(NavigationGeometryReservedRegionMatcher.GeometryRect.self,
                                 from: JSONSerialization.data(withJSONObject: XCTUnwrap(object)))
    }

    private func geometryRect(_ frame: CGRect) -> NavigationGeometryReservedRegionMatcher.GeometryRect {
        .init(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }
}
