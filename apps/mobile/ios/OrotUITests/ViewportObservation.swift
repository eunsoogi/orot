import XCTest

/// Records only fixed accessibility identifiers and geometry in the test runner.
@MainActor
enum ViewportObservation {
    static let identifiers = ["safe-area-root", "appointments-keyboard-root", "appointments-scroll", "appointments-title",
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
        result["timestampUnits"] = "unix-milliseconds"
        let bounds = result["windowBounds"] as? [String: Any] ?? [:]
        let insets = result["safeAreaInsets"] as? [String: Any] ?? [:]
        result["status"] = bounds.count == 4 && insets.count == 4 && result["sceneOrientation"] != nil && result["sampleStartedAtMs"] != nil && result["sampleEndedAtMs"] != nil ? "sampled" : "incomplete"
        return result
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
