import XCTest

/// Extends the existing geometry journey without changing the system's window arrangement.
@MainActor
enum NavigationWindowGeometryUITestConditions {
    static func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        XCTAssertTrue(target.isHittable)
        target.tap()
    }

    /// A single existing marker read retains its non-atomic native/React sampling boundary.
    /// Fullscreen runs do not exercise this conditional split assertion or prove its native passage.
    static func verifyObservedSplit(_ app: XCUIApplication, testCase: XCTestCase) throws {
        let report = try XCTUnwrap(NavigationUITestConditions.observationSnapshot(
            app, testCase: testCase, attachmentName: "window-side-geometry-raw",
        ))
        let native = try XCTUnwrap(report["windowGeometry"] as? [String: Any])
        let window = try rect(native["windowBounds"])
        let insets = try XCTUnwrap(native["safeAreaInsets"] as? [String: Double])
        let regions = try XCTUnwrap(native["reservedRegions"] as? [[String: Any]])
        var divisions: [(frame: CGRect, active: Bool)] = []
        for region in regions where region["kind"] as? String == "division" {
            let frame = try rect(region["frame"])
            if window.intersects(frame) {
                try divisions.append((frame, XCTUnwrap(region["isActive"] as? Bool)))
            }
        }
        // This independently sampled signature was observed with the app left of
        // the system divider. Other configurations retain the existing assertions.
        guard insets["left"] == 0, insets["right"] == 0,
              divisions.count == 1, let division = divisions.first, !division.active,
              division.frame.height > division.frame.width,
              division.frame.minX > window.midX,
              abs(division.frame.minY - window.minY) <= 0.5,
              abs(division.frame.maxY - window.maxY) <= 0.5,
              abs(division.frame.maxX - window.maxX) <= 0.5 else { return }

        let lifecycle = try XCTUnwrap(report["lifecycle"] as? [[String: Any]])
        let event = try XCTUnwrap(lifecycle.last { $0["event"] as? String == "navigation-content-frame" })
        let encoded = try XCTUnwrap(event["frame"] as? String)
        let shared = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String: Any])
        let sharedWindow = try rect(shared["windowFrame"])
        let viewport = try rect(shared["viewportFrame"])
        let available = try rect(shared["availableContentFrame"])
        let measured = try rect(shared["navigationFrame"])
        let controls = try XCTUnwrap(native["navigationControls"] as? [String: Any])
        XCTAssertEqual(controls["truncated"] as? Bool, false)
        let frames = try XCTUnwrap(controls["frames"] as? [[String: Any]])
        XCTAssertEqual(frames.count, 1, "A unique mounted navigation surface is required")
        let actual = try rect(XCTUnwrap(frames.first)["frame"])
        XCTAssertTrue(matches(window, sharedWindow))
        XCTAssertEqual(shared["side"] as? String, "left")
        XCTAssertTrue(matches(actual, measured), "Shared geometry must retain the actual native control frame")
        XCTAssertTrue(window.contains(actual))
        // The existing lane contract reserves the measured bar plus two 12pt
        // gutters once. UIKit's margin-inclusive inactive seam is not deducted.
        XCTAssertEqual(available.minX - window.minX, actual.width + 24, accuracy: 0.5)
        XCTAssertEqual(actual.midX - window.minX, (available.minX - window.minX) / 2, accuracy: 0.5)
        XCTAssertEqual(available.maxX, viewport.maxX, accuracy: 0.5, "The former opposite reservation must be released")
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        _ = try NavigationUITestConditions.navigationAction(app, "navigation-home")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "observed-left-window-navigation"
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
    }

    private static func rect(_ value: Any?) throws -> CGRect {
        let values = try XCTUnwrap(value as? [String: Double])
        return try CGRect(x: XCTUnwrap(values["x"]), y: XCTUnwrap(values["y"]),
                          width: XCTUnwrap(values["width"]), height: XCTUnwrap(values["height"]))
    }

    private static func matches(_ first: CGRect, _ second: CGRect) -> Bool {
        abs(first.minX - second.minX) <= 0.5 && abs(first.minY - second.minY) <= 0.5 &&
            abs(first.width - second.width) <= 0.5 && abs(first.height - second.height) <= 0.5
    }
}
