import XCTest

/// Measures the production Records action from UIKit geometry without splitting its VoiceOver group.
@MainActor
enum RecordingCaptureUITestConditions {
    @discardableResult
    static func verifyGeometry(in app: XCUIApplication, testCase: XCTestCase) throws -> CGRect {
        let button = UITestConditions.element(app, "records-new-recording")
        XCTAssertTrue(button.exists && button.isHittable)
        let subtitle = UITestConditions.element(app, "records-subtitle")
        XCTAssertTrue(subtitle.exists && !subtitle.frame.isEmpty)
        let marker = UITestConditions.element(app, "navigation-test-observation")
        var observed: [String: CGRect]?
        // Correlate to the currently rendered button, so a previous orientation's receipt cannot pass.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard marker.exists,
                  let report = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any],
                  let window = report["windowGeometry"] as? [String: Any],
                  let controls = window["navigationControls"] as? [String: Any],
                  controls["truncated"] as? Bool == false,
                  let frames = controls["frames"] as? [[String: Any]]
            else { return false }
            var current: [String: CGRect] = [:]
            for identifier in ["records-new-recording", "recording-capture-icon", "recording-capture-title"] {
                let matches = frames.filter { $0["identifier"] as? String == identifier }
                guard matches.count == 1, let frame = rect(matches[0]["frame"]), !frame.isEmpty else { return false }
                current[identifier] = frame
            }
            guard let nativeButton = current["records-new-recording"] else { return false }
            let actual = button.frame
            guard abs(nativeButton.minX - actual.minX) <= 0.5, abs(nativeButton.minY - actual.minY) <= 0.5,
                  abs(nativeButton.width - actual.width) <= 0.5, abs(nativeButton.height - actual.height) <= 0.5
            else { return false }
            observed = current
            return true
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        let frames = try XCTUnwrap(observed)
        let target = try XCTUnwrap(frames["records-new-recording"])
        let icon = try XCTUnwrap(frames["recording-capture-icon"])
        let title = try XCTUnwrap(frames["recording-capture-title"])
        // Preserve the real-route screenshot before assertions can stop a baseline spacing failure.
        let routeScreenshot = XCTAttachment(screenshot: app.screenshot())
        routeScreenshot.name = "records-recording-entry-route"
        routeScreenshot.lifetime = .keepAlways
        testCase.add(routeScreenshot)
        let measurements = """
        coordinateUnits=points
        records-subtitle=\(subtitle.frame.debugDescription)
        records-new-recording=\(target.debugDescription)
        recording-capture-icon=\(icon.debugDescription)
        recording-capture-title=\(title.debugDescription)
        subtitle-to-action-gap=\(target.minY - subtitle.frame.maxY)
        leading-icon-inset=\(icon.minX - target.minX)
        icon-title-gap=\(title.minX - icon.maxX)
        """
        // Keep numeric deltas beside the route screenshot on both passing and failing revisions.
        let geometryAttachment = XCTAttachment(string: measurements)
        geometryAttachment.name = "records-recording-entry-geometry"
        geometryAttachment.lifetime = .keepAlways
        testCase.add(geometryAttachment)
        try NavigationUITestConditions.panelSnapshot(app, frames: frames, testCase: testCase)
        XCTAssertGreaterThanOrEqual(target.width, 44)
        XCTAssertGreaterThanOrEqual(target.height, 44)
        XCTAssertEqual(target.minY - subtitle.frame.maxY, 16, accuracy: 1,
                       "The Records item gap is the sole space before the capture action.")
        XCTAssertEqual(icon.minX - target.minX, 16, accuracy: 1,
                       "The capture action uses the Records item inset.")
        XCTAssertTrue(target.insetBy(dx: -0.5, dy: -0.5).contains(icon))
        XCTAssertTrue(target.insetBy(dx: -0.5, dy: -0.5).contains(title))
        XCTAssertEqual(title.minX - icon.maxX, 12, accuracy: 1,
                       "The icon and label use the neighboring Records row gap.")
        XCTAssertEqual(icon.midY, title.midY, accuracy: 1, "The icon and wrapping label must share a horizontal row")
        return title
    }

    /// OCR checks the full rendered title; an untruncated accessibility label alone would miss visual clipping.
    static func renderedTitleHeight(in app: XCUIApplication, testCase: XCTestCase) throws -> CGFloat {
        let title = try verifyGeometry(in: app, testCase: testCase)
        try RenderedTextUITestConditions.verify(UITestConditions.element(app, "records-new-recording"), equals: "새 상담 녹음", in: app, testCase: testCase)
        return title.height
    }

    private static func rect(_ value: Any?) -> CGRect? {
        guard let value = value as? [String: Double], let x = value["x"], let y = value["y"],
              let width = value["width"], let height = value["height"],
              [x, y, width, height].allSatisfy(\.isFinite) else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }
}
