import XCTest

/// Uses current UIKit and committed shared geometry instead of XCTest's rotated application envelope.
@MainActor
enum NavigationGeometryUITestConditions {
    struct Snapshot {
        let window: CGRect
        let available: CGRect
        let fontScale: Double
        let regions: [[String: Any]]
    }

    static func snapshot(_ app: XCUIApplication, after requestedAt: Double? = nil,
                         width: CGFloat? = nil, differs: Bool = false) throws -> Snapshot
    {
        var observed: Snapshot?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let value = read(app, after: requestedAt) else { return false }
            if let width {
                let changed = abs(value.window.width - width) > 0.5
                guard changed == differs else { return false }
            }
            observed = value
            return true
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        return try XCTUnwrap(observed)
    }

    private static func read(_ app: XCUIApplication, after requestedAt: Double?) -> Snapshot? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists,
              let report = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any],
              let reference = report["windowGeometry"] as? [String: Any],
              let window = rect(reference["windowBounds"]),
              let lifecycle = report["lifecycle"] as? [[String: Any]],
              let native = lifecycle.last(where: { $0["event"] as? String == "window-geometry-context" }),
              let shared = lifecycle.last(where: { $0["event"] as? String == "navigation-content-frame" }),
              let nativeAt = native["atMs"] as? Double, let sharedAt = shared["atMs"] as? Double,
              let nativeJSON = native["normalizedSnapshot"] as? String,
              let sharedJSON = shared["frame"] as? String,
              let committed = try? JSONSerialization.jsonObject(with: Data(nativeJSON.utf8)) as? [String: Any],
              let frame = try? JSONSerialization.jsonObject(with: Data(sharedJSON.utf8)) as? [String: Any],
              let nativeWindow = rect(committed["windowBounds"]), let sharedWindow = rect(frame["windowFrame"]),
              let available = rect(frame["availableContentFrame"]),
              let active = lifecycle.last(where: { $0["event"] as? String == "adaptive-columns-layout" && $0["active"] as? Bool == true }),
              let scaleText = active["fontScale"] as? String, let scale = Double(scaleText),
              let regions = reference["reservedRegions"] as? [[String: Any]]
        else { return nil }
        // Both events must be newer than this request: an old matching receipt cannot prove rotation or return.
        if let requestedAt, min(nativeAt, sharedAt) <= requestedAt {
            return nil
        }
        guard sameWindow(window, nativeWindow), sameWindow(window, sharedWindow) else { return nil }
        return Snapshot(window: window, available: available, fontScale: scale, regions: regions)
    }

    private static func sameWindow(_ first: CGRect, _ second: CGRect) -> Bool {
        abs(first.minX - second.minX) < 0.5 && abs(first.minY - second.minY) < 0.5 &&
            abs(first.width - second.width) < 0.5 && abs(first.height - second.height) < 0.5
    }

    private static func rect(_ value: Any?) -> CGRect? {
        guard let value = value as? [String: Double], let x = value["x"], let y = value["y"],
              let width = value["width"], let height = value["height"] else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    static func expectsStacked(_ app: XCUIApplication, host: CGRect) throws -> Bool {
        let value = try snapshot(app)
        let readable = host.intersection(value.available)
        XCTAssertFalse(readable.isNull || readable.isEmpty)
        for region in value.regions where region["isActive"] as? Bool == true {
            guard let frame = rect(region["frame"]) else { continue }
            // UIViewReservedRegion.frame already includes the margins; the oracle must not reserve them twice.
            XCTAssertFalse(readable.intersects(frame), "A split/occluded panel needs an explicit region-aware oracle")
        }
        // This uninterrupted Settings layout requires two 320pt columns, scaled for text, and a 24pt gap.
        return readable.width < 640 * max(1, value.fontScale) + 24
    }

    /// Retains native containment, mutually exclusive axes and measured rail clearance.
    static func verifyPanels(_ app: XCUIApplication, prefix: String, navigationID: String, testCase: XCTestCase) throws -> Bool {
        let panels = ["primary", "secondary", "host"].map { UITestConditions.element(app, "\(prefix)-\($0)") }
        XCTAssertTrue(panels.allSatisfy { $0.waitForAppearance() })
        let primaryFrame = panels[0].frame, secondaryFrame = panels[1].frame
        let hostFrame = panels[2].frame.insetBy(dx: -1, dy: -1)
        XCTAssertTrue(hostFrame.contains(primaryFrame) && hostFrame.contains(secondaryFrame))
        let columns = abs(primaryFrame.minY - secondaryFrame.minY) <= 1 && primaryFrame.maxX <= secondaryFrame.minX + 1
        let stacked = abs(primaryFrame.minX - secondaryFrame.minX) <= 1 && primaryFrame.maxY <= secondaryFrame.minY + 1
        XCTAssertNotEqual(columns, stacked, "Panels must classify as exactly columns or stacked")
        let toolbar = try NavigationUITestConditions.navigationAction(app, navigationID).toolbar
        try NavigationUITestConditions.panelSnapshot(app, frames: ["window": app.frame, "host": panels[2].frame, "primary": primaryFrame, "secondary": secondaryFrame, "navigation": toolbar.frame], testCase: testCase)
        guard toolbar.frame.height > toolbar.frame.width else { return stacked }
        XCTAssertLessThanOrEqual(max(primaryFrame.maxX, secondaryFrame.maxX), toolbar.frame.minX + 1)
        return stacked
    }

    /// Keep native frame equality separate from route existence and from the shared contract's own calculation.
    static func captureBoundary(_ app: XCUIApplication, navigationID: String, name: String, testCase: XCTestCase) throws {
        let content = UITestConditions.element(app, "navigation-content-region")
        XCTAssertTrue(content.exists && !content.frame.isEmpty)
        let action = try NavigationUITestConditions.navigationAction(app, navigationID)
        let marker = UITestConditions.element(app, "navigation-test-observation")
        // Preserve independent numeric pairs even when a later completion predicate never matches.
        let initialContentFrame = content.frame, initialNavigationFrame = action.toolbar.frame
        try NavigationUITestConditions.panelSnapshot(app, frames: ["content": initialContentFrame, "navigation": initialNavigationFrame], testCase: testCase)
        let initial = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "boundary-before-comparison")
        if let lifecycle = initial?["lifecycle"] as? [[String: Any]],
           let event = lifecycle.last(where: { $0["event"] as? String == "navigation-content-frame" }),
           let json = event["frame"] as? String,
           let shared = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
           let available = rect(shared["availableContentFrame"]), let navigation = rect(shared["navigationFrame"])
        {
            let diagnostic = ["contentMatches": sameWindow(initialContentFrame, available), "navigationMatches": sameWindow(initialNavigationFrame, navigation)]
            let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: diagnostic), uniformTypeIdentifier: "public.json")
            attachment.name = "boundary-comparison-results"
            attachment.lifetime = .keepAlways
            testCase.add(attachment)
        }
        var last: [String: Any]?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard marker.exists,
                  let report = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any],
                  let lifecycle = report["lifecycle"] as? [[String: Any]],
                  let event = lifecycle.last(where: { $0["event"] as? String == "navigation-content-frame" }),
                  let json = event["frame"] as? String,
                  let shared = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  let available = rect(shared["availableContentFrame"]),
                  let navigation = rect(shared["navigationFrame"])
            else { return false }
            last = shared
            return sameWindow(content.frame, available) && sameWindow(action.toolbar.frame, navigation)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, "Native content and navigation must match their reported window frames")
        let measuredContent = content.frame, measuredBar = action.toolbar.frame
        if measuredBar.height > measuredBar.width {
            let shared = try XCTUnwrap(last)
            let window = try XCTUnwrap(rect(shared["windowFrame"]))
            let available = try XCTUnwrap(rect(shared["availableContentFrame"]))
            let centerX = shared["side"] as? String == "left" ? (window.minX + available.minX) / 2 : (available.maxX + window.maxX) / 2
            XCTAssertEqual(measuredBar.midX, centerX, accuracy: 0.5, "The rail must be centered in its one reserved side lane")
            XCTAssertFalse(measuredContent.intersects(measuredBar))
        }
        try NavigationUITestConditions.panelSnapshot(app, frames: ["content": measuredContent, "navigation": measuredBar, "control": action.control.frame], testCase: testCase)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
    }

    /// Preserve the recording route's existing readiness check before measuring its actual content and actions.
    static func captureRecordingBoundary(_ app: XCUIApplication, testCase: XCTestCase) throws {
        NavigationUITestConditions.route(app, markers: ["recording-controls-scroll"])
        try captureBoundary(app, navigationID: "navigation-home", name: "recording-content-boundary", testCase: testCase)
    }

    /// Keep the selected root and its real viewport together in every observation.
    static func verifyRootBoundaries(_ app: XCUIApplication, testCase: XCTestCase) throws {
        _ = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "right-rail-native-geometry")
        let roots = [("home", ["welcome-title"]), ("records", ["records-title"]),
                     ("schedule", ["calendar-title", "schedule-retry"]), ("ai", ["ai-features-screen"]),
                     ("settings", ["settings-title"])]
        for (tab, markers) in roots {
            try NavigationUITestConditions.openTab(app, tab, markers: markers)
            XCTAssertTrue(try NavigationUITestConditions.navigationAction(app, "navigation-tab-\(tab)").control.isSelected)
            try captureBoundary(app, navigationID: "navigation-tab-\(tab)", name: "duo-root-\(tab)-boundary", testCase: testCase)
        }
        try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
    }
}
