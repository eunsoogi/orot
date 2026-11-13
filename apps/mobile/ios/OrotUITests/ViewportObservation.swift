import XCTest

/// Records only fixed accessibility identifiers and geometry in the test runner.
@MainActor
enum ViewportObservation {
    static let identifiers = ["safe-area-root", "appointments-keyboard-root", "appointments-scroll", "appointments-title",
                              "appointments-columns-frame-host", "appointments-columns-primary", "appointments-columns-secondary",
                              "appointments-back", "navigation-toolbar", "navigation-tab-settings", "navigation-route-scroll",
                              "welcome-title", "settings-title", "navigation-keyboard-avoiding-root", "navigation-content-region",
                              "navigation-root-tabs-glass-backdrop"]

    static var enabled: Bool {
        ProcessInfo.processInfo.environment["OROT_TEST_VIEWPORT_OBSERVATION"] == "YES"
    }

    static var arguments: [String] {
        enabled ? ["-OROT_TEST_NAVIGATION_OBSERVATION", "YES"] : []
    }

    static func captureIfEnabled(_ app: XCUIApplication, entry: String, stage: String, testCase: XCTestCase) {
        guard enabled else { return }
        capture(app, entry: entry, stage: stage, testCase: testCase)
    }

    /// Preserve the existing navigation path while sampling before its route wait can fail.
    static func openSettings(_ app: XCUIApplication, testCase: XCTestCase) throws {
        guard enabled else {
            try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
            return
        }
        capture(app, entry: "core-home", stage: "before-settings-action", testCase: testCase)
        if try NavigationPageActionUITestConditions.openOverflowTab(app, tab: "settings") {
            capture(app, entry: "core-home", stage: "overflow-settings-action-returned", testCase: testCase)
        } else {
            try NavigationUITestConditions.tapNavigation(app, "navigation-tab-settings")
            capture(app, entry: "core-home", stage: "toolbar-settings-tap-returned", testCase: testCase)
        }
        NavigationUITestConditions.route(app, markers: ["settings-title"])
    }

    static func rect(_ frame: CGRect) -> [String: Double] {
        ["x": frame.origin.x, "y": frame.origin.y, "width": frame.width, "height": frame.height]
    }

    /// Preserve only the public native geometry fields; marker contents can contain unrelated route data.
    static func nativeGeometry(_ report: [String: Any]) -> [String: Any] {
        guard let geometry = report["windowGeometry"] as? [String: Any] else { return ["status": "unavailable"] }
        var result: [String: Any] = [:]
        for (key, fields) in [("windowBounds", ["x", "y", "width", "height"]), ("safeAreaInsets", ["top", "right", "bottom", "left"])] {
            guard let values = geometry[key] as? [String: Any] else { continue }
            result[key] = values.filter { fields.contains($0.key) && $0.value is NSNumber }
        }
        for key in ["sceneOrientation", "sampleStartedAtMs", "sampleEndedAtMs"] {
            if let value = geometry[key] as? NSNumber {
                result[key] = value
            }
        }
        if let supported = geometry["reservedRegionsSupported"] as? Bool {
            result["reservedRegionsSupported"] = supported
        }
        if let regions = geometry["reservedRegions"] as? [[String: Any]] {
            result["reservedRegions"] = regions.compactMap { region -> [String: Any]? in
                guard let kind = region["kind"] as? String, ["division", "occlusion"].contains(kind),
                      let active = region["isActive"] as? Bool, let frame = region["frame"] as? [String: Any] else { return nil }
                return ["kind": kind, "isActive": active,
                        "frame": frame.filter { ["x", "y", "width", "height"].contains($0.key) && $0.value is NSNumber }]
            }
        }
        result["timestampUnits"] = "unix-milliseconds"
        let bounds = result["windowBounds"] as? [String: Any] ?? [:]
        let insets = result["safeAreaInsets"] as? [String: Any] ?? [:]
        result["status"] = bounds.count == 4 && insets.count == 4 && result["sceneOrientation"] != nil && result["sampleStartedAtMs"] != nil && result["sampleEndedAtMs"] != nil ? "sampled" : "incomplete"
        return result
    }

    /// UIKit and AX are separate samples; matching geometry before and after bounds their use, not atomicity.
    static func verifyAppointmentViewport(_ app: XCUIApplication, scroll: XCUIElement, title: XCUIElement,
                                          action: NavigationUITestConditions.NavigationAction,
                                          launchedAt: Double, testCase: XCTestCase) throws -> CGRect
    {
        func sample() throws -> [String: Any] {
            let marker = UITestConditions.element(app, "navigation-test-observation")
            XCTAssertTrue(marker.exists)
            let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any])
            var geometry = nativeGeometry(raw)
            XCTAssertEqual(geometry["status"] as? String, "sampled")
            let reference = try XCTUnwrap(raw["windowGeometry"] as? [String: Any])
            let dock = try XCTUnwrap(reference["dockControls"] as? [String: Any])
            for key in ["windowID", "sceneID", "visibleKeyWindowCount", "windowFrameInScreen", "bodyLineHeight", "contentSizeCategory"] {
                geometry[key] = dock[key]
            }
            return geometry
        }
        let before = try sample()
        let axStarted = Date().timeIntervalSince1970 * 1000
        let application = app.frame, window = app.windows.firstMatch
        XCTAssertEqual(app.windows.count, 1)
        XCTAssertTrue(window.exists)
        let windowFrame = window.frame, scrollFrame = scroll.frame, titleFrame = title.frame
        let toolbarFrame = action.toolbar.frame, backFrame = action.control.frame
        let backHittable = action.control.isHittable
        let after = try sample()
        let receipt: [String: Any] = ["before": before, "after": after, "applicationFrame": rect(application), "coordinateUnits": "points", "sampling": "non-atomic"]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]), uniformTypeIdentifier: "public.json")
        attachment.name = "appointment-safe-area-samples"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        let beforeBounds = try XCTUnwrap(before["windowBounds"] as? [String: Double])
        let afterBounds = try XCTUnwrap(after["windowBounds"] as? [String: Double])
        let beforeInsets = try XCTUnwrap(before["safeAreaInsets"] as? [String: Double])
        let afterInsets = try XCTUnwrap(after["safeAreaInsets"] as? [String: Double])
        let beforeWindow = try XCTUnwrap(before["windowID"] as? String), afterWindow = try XCTUnwrap(after["windowID"] as? String)
        let scene = try XCTUnwrap(before["sceneID"] as? String)
        let firstStart = try XCTUnwrap(before["sampleStartedAtMs"] as? Double), firstEnd = try XCTUnwrap(before["sampleEndedAtMs"] as? Double)
        let secondStart = try XCTUnwrap(after["sampleStartedAtMs"] as? Double), secondEnd = try XCTUnwrap(after["sampleEndedAtMs"] as? Double)
        XCTAssertTrue(AppointmentViewportGeometry.samplesBracketAX(launch: launchedAt, axStart: axStarted, firstStart: firstStart, firstEnd: firstEnd,
                                                                   secondStart: secondStart, secondEnd: secondEnd, firstWindow: beforeWindow, secondWindow: afterWindow))
        XCTAssertEqual(before["visibleKeyWindowCount"] as? Int, 1)
        XCTAssertEqual(after["visibleKeyWindowCount"] as? Int, 1)
        XCTAssertFalse(scene.isEmpty)
        XCTAssertEqual(after["sceneID"] as? String, scene)
        let screenFrame = try XCTUnwrap(before["windowFrameInScreen"] as? [String: Double])
        XCTAssertEqual(screenFrame, after["windowFrameInScreen"] as? [String: Double])
        let bodyLineHeight = try XCTUnwrap(before["bodyLineHeight"] as? Double)
        let category = try XCTUnwrap(before["contentSizeCategory"] as? String)
        XCTAssertFalse(category.isEmpty)
        XCTAssertEqual(after["contentSizeCategory"] as? String, category)
        XCTAssertEqual(after["bodyLineHeight"] as? Double, bodyLineHeight)
        XCTAssertEqual(beforeBounds, afterBounds)
        XCTAssertEqual(beforeInsets, afterInsets)
        XCTAssertEqual(before["sceneOrientation"] as? Int, after["sceneOrientation"] as? Int)
        // XCUIApplication's envelope can use another coordinate space; the owned AX window is the viewport.
        XCTAssertEqual(window.descendants(matching: .any).matching(identifier: action.control.identifier).count, 1)
        let nativeScreen = try CGRect(x: XCTUnwrap(screenFrame["x"]), y: XCTUnwrap(screenFrame["y"]),
                                      width: XCTUnwrap(screenFrame["width"]), height: XCTUnwrap(screenFrame["height"]))
        let nativeBounds = try CGRect(x: XCTUnwrap(beforeBounds["x"]), y: XCTUnwrap(beforeBounds["y"]),
                                      width: XCTUnwrap(beforeBounds["width"]), height: XCTUnwrap(beforeBounds["height"]))
        XCTAssertTrue(AppointmentViewportGeometry.matchesOwningWindow(windowFrame, screen: nativeScreen, nativeBounds: nativeBounds),
                      "The AX window must match the same native window in screen coordinates")
        let insets = try AppointmentViewportGeometry.Insets(top: XCTUnwrap(beforeInsets["top"]), right: XCTUnwrap(beforeInsets["right"]),
                                                            bottom: XCTUnwrap(beforeInsets["bottom"]), left: XCTUnwrap(beforeInsets["left"]))
        XCTAssertTrue(AppointmentViewportGeometry.accepts(window: windowFrame, insets: insets, scroll: scrollFrame, title: titleFrame, toolbar: toolbarFrame, minimumTitleHeight: bodyLineHeight),
                      "Scroll and title must remain inside the native safe viewport and clear navigation")
        XCTAssertTrue(AppointmentViewportGeometry.isUsableTarget(backFrame, hittable: backHittable), "Back must remain a hittable 44-point target")
        return try XCTUnwrap(AppointmentViewportGeometry.safeFrame(window: windowFrame, insets: insets))
    }

    static func capture(_ app: XCUIApplication, entry: String, stage: String, testCase: XCTestCase) {
        let started = Date().timeIntervalSince1970 * 1000
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let bytes = marker.exists ? Data(UITestConditions.text(marker).utf8) : Data()
        let report = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] ?? [:]
        var matches: [[String: Any]] = []
        for identifier in identifiers {
            let query = app.descendants(matching: .any).matching(identifier: identifier)
            let elements = query.allElementsBoundByIndex
            let frames = elements.map { ["frame": rect($0.frame), "hittable": $0.isHittable] as [String: Any] }
            // Only relationships among allowlisted IDs are emitted, never arbitrary ancestor labels.
            let descendants = identifiers.filter { child in
                child != identifier && elements.contains { $0.descendants(matching: .any).matching(identifier: child).count > 0 }
            }
            matches.append(["identifier": identifier, "count": elements.count, "frames": frames, "descendantIDs": descendants])
        }
        let environment = ProcessInfo.processInfo.environment
        var native = nativeGeometry(report)
        if let ended = native["sampleEndedAtMs"] as? Double {
            native["ageAtCaptureStartMs"] = started - ended
            native["samplingRelationship"] = ended < started ? "earlier-cached-sample" : "overlapping-or-later"
        }
        let payload: [String: Any] = ["entry": entry, "stage": stage, "units": "points", "appFrame": rect(app.frame),
                                      "deviceOrientation": XCUIDevice.shared.orientation.rawValue,
                                      "sourceRevision": environment["OROT_TEST_SOURCE_REVISION"] ?? "unavailable",
                                      "deviceID": environment["SIMULATOR_UDID"] ?? "unavailable",
                                      "runtime": environment["SIMULATOR_RUNTIME_VERSION"] ?? "unavailable",
                                      "nativeGeometry": native, "matches": matches,
                                      "sampleStartedAtMs": started, "sampleEndedAtMs": Date().timeIntervalSince1970 * 1000]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "viewport-\(entry)-\(stage)"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
}
