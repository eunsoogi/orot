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
        var hasActiveReservation = false
        for region in regions {
            let frame = try rect(region["frame"])
            if window.intersects(frame) {
                let active = try XCTUnwrap(region["isActive"] as? Bool)
                hasActiveReservation = hasActiveReservation || active
                if region["kind"] as? String == "division" {
                    divisions.append((frame, active))
                }
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
        let safe = try CGRect(x: window.minX, y: window.minY + XCTUnwrap(insets["top"]),
                              width: window.width,
                              height: window.height - XCTUnwrap(insets["top"]) - XCTUnwrap(insets["bottom"]))
        let visible = viewport.intersection(safe)
        // Assert the rail only in a conservatively admitted region: 48pt controls,
        // two 12pt gutters, a readable 320pt column and a complete 276pt root stack.
        // Narrow/short/keyboard-contracted or actively reserved regions may use bottom.
        // Never let the observed toolbar's size or reported side disable this oracle.
        guard !hasActiveReservation, visible.width - 72 >= 320, visible.height >= 300 else { return }
        let available = try rect(shared["availableContentFrame"])
        let measured = try rect(shared["navigationFrame"])
        let controls = try XCTUnwrap(native["navigationControls"] as? [String: Any])
        XCTAssertEqual(controls["truncated"] as? Bool, false)
        let frames = try XCTUnwrap(controls["frames"] as? [[String: Any]])
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let home = try NavigationUITestConditions.navigationAction(app, "navigation-home")
        XCTAssertTrue(matches(back.toolbar.frame, home.toolbar.frame))
        // XCTest frames use screen points; the marker uses window points. Bind
        // the Back/Home toolbar to its app window before selecting its marker.
        // A separate primary-only toolbar is expected and must not be counted as a duplicate rail.
        let windows = app.windows.allElementsBoundByIndex.filter {
            $0.exists && abs($0.frame.width - window.width) <= 0.5 &&
                abs($0.frame.height - window.height) <= 0.5 && $0.frame.contains(back.toolbar.frame)
        }
        XCTAssertEqual(windows.count, 1, "The navigation toolbar must belong to one observed app window")
        let screenWindow = try XCTUnwrap(windows.first).frame
        let toolbar = back.toolbar.frame.offsetBy(dx: window.minX - screenWindow.minX,
                                                  dy: window.minY - screenWindow.minY)
        let navigationFrames = try frames.map { try rect($0["frame"]) }.filter { matches($0, toolbar) }
        XCTAssertEqual(navigationFrames.count, 1, "The Back/Home toolbar must have one native marker frame")
        let actual = try XCTUnwrap(navigationFrames.first)
        XCTAssertTrue(matches(window, sharedWindow))
        XCTAssertEqual(shared["side"] as? String, "left")
        XCTAssertTrue(matches(actual, measured), "Shared geometry must retain the actual native control frame")
        XCTAssertTrue(window.contains(actual))
        let content = UITestConditions.element(app, "navigation-content-region")
        XCTAssertTrue(UITestConditions.exists(content))
        let actualContent = content.frame.offsetBy(dx: window.minX - screenWindow.minX,
                                                   dy: window.minY - screenWindow.minY)
        XCTAssertTrue(matches(actualContent, available), "Rendered content must consume the shared available frame")
        // The existing lane contract reserves the measured bar plus two 12pt
        // gutters once. UIKit's margin-inclusive inactive seam is not deducted.
        XCTAssertEqual(available.minX - window.minX, actual.width + 24, accuracy: 0.5)
        XCTAssertEqual(actual.midX - window.minX, (available.minX - window.minX) / 2, accuracy: 0.5)
        XCTAssertEqual(available.maxX, viewport.maxX, accuracy: 0.5, "The former opposite reservation must be released")
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
