import XCTest

/// Checks the visible representation of conversation page actions without assuming they always fit directly.
@MainActor
enum FeatureEntryDuoActionConditions {
    /// Check real native and accessibility coordinates before exercising an already-open Duo window.
    static func verifyOpenConversation(testCase: XCTestCase) throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE", "synthetic", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_NAVIGATION_FOCUS_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if ProcessInfo.processInfo.environment["OROT_TEST_DUO_SOURCE_BACK_OBSERVATION"] == "1" {
            app.launchArguments += ["-OROT_TEST_DUO_RAIL_MOUNT_OBSERVATION", "YES"]
        }
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")))
        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(input.exists && input.isHittable)
        input.tap()
        input.typeText("source")
        NavigationWindowGeometryUITestConditions.tap(app, "rag-conversation-send")
        let source = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
        XCTAssertTrue(UITestConditions.exists(source))
        input.tap()
        input.typeText("open duo draft")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        let report = try snapshot(app, name: "duo-open-functional", testCase: testCase)
        let state = XCTAttachment(string: "app=\(app.frame), windows=\(app.windows.allElementsBoundByIndex.map(\.frame)), home=\(UITestConditions.element(app, "navigation-tab-overview").frame), input=\(input.frame), keyboard=\(app.keyboards.firstMatch.frame)")
        state.name = "duo-open-functional-frames"
        state.lifetime = .keepAlways
        testCase.add(state)
        let geometry = try XCTUnwrap(report["windowGeometry"] as? [String: Any])
        let controls = try XCTUnwrap(geometry["navigationControls"] as? [String: Any])
        let homeNative = try XCTUnwrap(controls["homeFocus"] as? [String: Any])
        XCTAssertEqual(homeNative["status"] as? String, "available")
        let home = UITestConditions.element(app, "navigation-tab-overview")
        let tree = try app.snapshot()
        let matches = snapshotWindows(tree, ancestors: [])
        XCTAssertEqual(matches.count, 1, app.debugDescription)
        let (snapshotHome, ancestors) = try XCTUnwrap(matches.first)
        XCTAssertEqual(ancestors.count, 1, "The unique Home node must have exactly one Window ancestor")
        let axWindow = try XCTUnwrap(ancestors.first)
        let dock = try XCTUnwrap(geometry["dockControls"] as? [String: Any])
        try assertRect(dock["windowFrameInScreen"], equals: axWindow.frame)
        try assertRect(homeNative["accessibilityFrameInScreen"], equals: snapshotHome.frame)
        try assertRect(homeNative["nativeFrameInWindow"], equals: snapshotHome.frame)
        assertSameRect(snapshotHome.frame, home.frame)
        XCTAssertEqual(try XCTUnwrap(homeNative["windowID"] as? String), try XCTUnwrap(dock["windowID"] as? String))
        let regions = try XCTUnwrap(geometry["reservedRegions"] as? [[String: Any]])
        let divisions = regions.filter { $0["kind"] as? String == "division" }
        let events = try XCTUnwrap(report["lifecycle"] as? [[String: Any]])
        let contextEvent = try XCTUnwrap(events.last { $0["event"] as? String == "window-geometry-context" })
        let contextText = try XCTUnwrap(contextEvent["normalizedSnapshot"] as? String)
        let context = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contextText.utf8)) as? [String: Any])
        let sharedRegions = try XCTUnwrap(context["reservedRegions"] as? [[String: Any]])
        let sharedDivisions = sharedRegions.filter { $0["kind"] as? String == "division" }
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: divisions, options: [.sortedKeys]), try JSONSerialization.data(withJSONObject: sharedDivisions, options: [.sortedKeys]))
        for division in divisions {
            _ = try XCTUnwrap(division["isActive"] as? Bool)
            _ = try rect(division["frame"])
            let margins = try XCTUnwrap(division["margins"] as? [String: Double])
            for edge in ["top", "right", "bottom", "left"] {
                XCTAssertTrue(try XCTUnwrap(margins[edge]).isFinite)
            }
        }
        let activeDivisions = try divisions.filter { $0["isActive"] as? Bool == true }.map { try rect($0["frame"]) }
        for id in ["navigation-tab-overview", "rag-conversation-input"] {
            let target = UITestConditions.element(app, id)
            XCTAssertTrue(target.exists && target.isHittable)
            XCTAssertGreaterThanOrEqual(target.frame.width, 44)
            XCTAssertGreaterThanOrEqual(target.frame.height, 44)
            // UIKit's reserved frame already includes its reported margins.
            for frame in activeDivisions {
                XCTAssertFalse(target.frame.intersects(frame), app.debugDescription)
            }
        }
        try openAction(app, id: "rag-conversation-sessions-toggle", label: "대화 목록", window: axWindow.frame, divisions: activeDivisions)
        NavigationUITestConditions.route(app, markers: ["conversation-history-screen"])
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        XCTAssertEqual(input.value as? String, "open duo draft")
        XCTAssertTrue(source.exists && source.isHittable)
        let sourceBaseline = try FeatureEntryDuoActionConditions.sourceTransitionBaseline(app, testCase: testCase)
        source.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "ai-feature-source-detail")))
        try FeatureEntryDuoActionConditions.waitForSourceTransition(app, baseline: sourceBaseline, testCase: testCase)
        if ProcessInfo.processInfo.environment["OROT_TEST_DUO_SOURCE_BACK_OBSERVATION"] == "1" {
            try FeatureEntryDuoActionConditions.captureSourceBack(app, baseline: sourceBaseline, testCase: testCase)
            throw XCTSkip("Source Back observation captured before functional return")
        }
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["rag-conversation-screen"])
        XCTAssertEqual(input.value as? String, "open duo draft")
        try openAction(app, id: "rag-conversation-new-session", label: "새 대화", window: axWindow.frame, divisions: activeDivisions)
        XCTAssertTrue(input.exists && input.isHittable)
        XCTAssertFalse((input.value as? String ?? "open duo draft").contains("open duo draft"))
    }

    private static func snapshotWindows(_ node: XCUIElementSnapshot, ancestors: [XCUIElementSnapshot]) -> [(XCUIElementSnapshot, [XCUIElementSnapshot])] {
        var matches: [(XCUIElementSnapshot, [XCUIElementSnapshot])] = []
        if node.identifier == "navigation-tab-overview" {
            let windows = ancestors.filter { $0.elementType == .window }
            matches.append((node, windows))
        }
        for child in node.children {
            matches += snapshotWindows(child, ancestors: ancestors + [node])
        }
        return matches
    }

    private static func openAction(_ app: XCUIApplication, id: String, label: String, window: CGRect, divisions: [CGRect]) throws {
        let direct = UITestConditions.element(app, id)
        let button = direct.exists ? direct : app.buttons["navigation-page-action-overflow"]
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: button.identifier).count, 1)
        XCTAssertTrue(button.exists && button.isHittable && button.isEnabled)
        let visible = button.frame.intersection(window)
        XCTAssertGreaterThanOrEqual(visible.width, 44)
        XCTAssertGreaterThanOrEqual(visible.height, 44)
        for division in divisions {
            XCTAssertFalse(button.frame.intersects(division))
        }
        let target = NavigationPageActionUITestConditions.pageAction(app, id: id, label: label)
        if !direct.exists {
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == %@", label)).count, 1)
        }
        XCTAssertTrue(target.exists && target.isHittable && target.isEnabled)
        let targetVisible = target.frame.intersection(window)
        XCTAssertGreaterThanOrEqual(targetVisible.width, 44)
        XCTAssertGreaterThanOrEqual(targetVisible.height, 44)
        for division in divisions {
            XCTAssertFalse(targetVisible.intersects(division))
        }
        target.tap()
    }

    private static func rect(_ value: Any?) throws -> CGRect {
        let data = try XCTUnwrap(value as? [String: Double])
        for key in ["x", "y", "width", "height"] {
            XCTAssertTrue(try XCTUnwrap(data[key]).isFinite)
        }
        return try CGRect(x: XCTUnwrap(data["x"]), y: XCTUnwrap(data["y"]), width: XCTUnwrap(data["width"]), height: XCTUnwrap(data["height"]))
    }

    private static func assertRect(_ value: Any?, equals actual: CGRect) throws {
        let expected = try rect(value)
        assertSameRect(expected, actual)
    }

    private static func assertSameRect(_ expected: CGRect, _ actual: CGRect) {
        XCTAssertEqual(expected.minX, actual.minX, accuracy: 0.5)
        XCTAssertEqual(expected.minY, actual.minY, accuracy: 0.5)
        XCTAssertEqual(expected.width, actual.width, accuracy: 0.5)
        XCTAssertEqual(expected.height, actual.height, accuracy: 0.5)
    }

    /// Capture a real window before and after the owner changes Device Hub; this is diagnostic, not a feature pass.
    static func observeExternalTransition(testCase: XCTestCase) throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-OROT_TEST_NAVIGATION_FOCUS_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "rag-conversation-screen")))
        try NavigationUITestConditions.openTab(app, "conversation", markers: ["rag-conversation-screen"])
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(input.exists && input.isHittable)
        input.tap()
        let draft = "synthetic draft retained"
        input.typeText(draft)
        XCTAssertEqual(input.value as? String, draft)
        let baseline = try snapshot(app, name: "duo-external-before", testCase: testCase)
        let originalGeometry = try geometryKey(baseline)
        let originalDock = try XCTUnwrap((baseline["windowGeometry"] as? [String: Any])?["dockControls"] as? [String: Any])
        let initialWindow = try XCTUnwrap(originalDock["windowID"] as? String)
        let initialScene = try XCTUnwrap(originalDock["sceneID"] as? String)
        let observer = try XCTUnwrap(baseline["observerID"] as? String)
        let baselineData = try JSONSerialization.data(withJSONObject: baseline, options: [.sortedKeys])
        print("OROT_EXTERNAL_DUO_BASELINE \(String(decoding: baselineData, as: UTF8.self))")
        try print("OROT_EXTERNAL_DUO_AX input=\(input.frame) screen=\(UITestConditions.element(app, "rag-conversation-screen").frame) toolbar=\(NavigationUITestConditions.navigationAction(app, "navigation-tab-conversation").toolbar.frame)")
        print("OROT_EXTERNAL_DUO_READY atMs=\(Date().timeIntervalSince1970 * 1000) window=\(initialWindow) scene=\(initialScene) frame=\(app.frame)")
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let report = currentSnapshot(app), let key = try? geometryKey(report) else { return false }
            return key != originalGeometry
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed, "A Device Hub action must produce an actual native geometry change")
        let after = try snapshot(app, name: "duo-external-after", testCase: testCase)
        XCTAssertEqual(after["observerID"] as? String, observer)
        XCTAssertNotEqual(try geometryKey(after), originalGeometry, "The retained after sample must show the change")
        let dock = try XCTUnwrap((after["windowGeometry"] as? [String: Any])?["dockControls"] as? [String: Any])
        XCTAssertEqual(dock["windowID"] as? String, initialWindow)
        XCTAssertEqual(dock["sceneID"] as? String, initialScene)
        XCTAssertTrue(UITestConditions.element(app, "rag-conversation-screen").exists)
        XCTAssertEqual(input.value as? String, draft)
        print("OROT_EXTERNAL_DUO_CHANGED atMs=\(Date().timeIntervalSince1970 * 1000) window=\(initialWindow) scene=\(initialScene) frame=\(app.frame)")
        throw XCTSkip("External Duo transition captured; functional reflow remains separate")
    }

    private static func currentSnapshot(_ app: XCUIApplication) -> [String: Any]? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8))) as? [String: Any]
    }

    private static func geometryKey(_ report: [String: Any]) throws -> Data {
        let geometry = try XCTUnwrap(report["windowGeometry"] as? [String: Any])
        let keys = ["windowBounds", "safeAreaInsets", "reservedRegions", "sceneOrientation"]
        var selected: [String: Any] = [:]
        for key in keys {
            selected[key] = try XCTUnwrap(geometry[key])
        }
        return try JSONSerialization.data(withJSONObject: selected, options: [.sortedKeys])
    }

    private static func snapshot(_ app: XCUIApplication, name: String, testCase: XCTestCase) throws -> [String: Any] {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name + "-screen"
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"
        hierarchy.lifetime = .keepAlways
        testCase.add(hierarchy)
        return try XCTUnwrap(NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: name + "-native"))
    }
}
