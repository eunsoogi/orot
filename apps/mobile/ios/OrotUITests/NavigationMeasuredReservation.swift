import CoreGraphics
import Foundation
import XCTest

/// Recognizes an active top-edge occlusion overlapping the measured right-side lane.
enum NavigationMeasuredReservation {
    /// Identifies the edge-clipped division that selects the left Split rail.
    static func leftSplit(_ shared: [String: Any], window: CGRect) -> Bool {
        guard let regions = shared["reservedRegions"] as? [[String: Any]] else { return false }
        let divisions = regions.filter { $0["kind"] as? String == "division" }
        guard divisions.count == 1, let region = divisions.first, region["isActive"] as? Bool == false,
              let frame = region["frame"] as? [String: Double], let x = frame["x"], let y = frame["y"],
              let width = frame["width"], let height = frame["height"] else { return false }
        return height > width && x > window.midX && abs(y - window.minY) <= 0.5 &&
            abs(y + height - window.maxY) <= 0.5 && abs(x + width - window.maxX) <= 0.5
    }

    static func matches(_ shared: [String: Any], window: CGRect, available: CGRect) -> Bool {
        guard abs(window.maxX - available.maxX - 84) < 0.5,
              let regions = shared["reservedRegions"] as? [[String: Any]] else { return false }
        return regions.contains { region in
            guard region["kind"] as? String == "occlusion", region["isActive"] as? Bool == true,
                  let frame = region["frame"] as? [String: Double],
                  let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"] else { return false }
            return x <= available.maxX + 0.5 && x + width >= window.maxX - 0.5 && y <= window.minY && y + height > window.minY
        }
    }
}

extension NavigationGeometryUITestConditions {
    /// Check the rendered side and each distinct native control after the keyboard changes the available rail space.
    @MainActor
    static func assertKeyboardSavePlacement(_ app: XCUIApplication, save: XCUIElement, keyboardTop: Double, testCase: XCTestCase) throws {
        let state = try observedNavigationSide(app, testCase: testCase)
        XCTAssertTrue(state.keyboardVisible)
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let home = try NavigationUITestConditions.navigationAction(app, "navigation-home")
        if state.side == "right" {
            XCTAssertLessThan(save.frame.maxX, back.toolbar.frame.minX)
            return
        }
        XCTAssertEqual(state.side, "bottom")
        let pageBar = UITestConditions.element(app, "navigation-page-action-toolbar")
        let cancel = UITestConditions.element(app, "next-visit-review-cancel")
        let content = UITestConditions.element(app, "navigation-content-region")
        let buttons = [back.control, save, cancel, home.control]
        XCTAssertTrue(pageBar.exists && pageBar.isHittable && content.exists)
        for (index, button) in buttons.enumerated() {
            let frame = button.frame
            XCTAssertTrue(button.exists && button.isHittable && button.isEnabled, app.debugDescription)
            XCTAssertGreaterThanOrEqual(frame.width, 44)
            XCTAssertGreaterThanOrEqual(frame.height, 44)
            XCTAssertTrue(app.frame.contains(frame) && content.frame.contains(frame), app.debugDescription)
            XCTAssertLessThanOrEqual(frame.maxY, CGFloat(keyboardTop))
            for other in buttons.dropFirst(index + 1) {
                XCTAssertFalse(frame.intersects(other.frame), app.debugDescription)
            }
        }
        XCTAssertTrue(pageBar.frame.contains(save.frame) && pageBar.frame.contains(cancel.frame))
        XCTAssertLessThanOrEqual(back.toolbar.frame.maxY, CGFloat(keyboardTop))
        XCTAssertLessThanOrEqual(pageBar.frame.maxY, CGFloat(keyboardTop))
        let report = try XCTUnwrap(NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "keyboard-save-native-controls"))
        let events = try XCTUnwrap(report["lifecycle"] as? [[String: Any]])
        let frameEvent = try XCTUnwrap(events.last { $0["event"] as? String == "navigation-content-frame" })
        let frameText = try XCTUnwrap(frameEvent["frame"] as? String)
        let shared = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(frameText.utf8)) as? [String: Any])
        XCTAssertEqual(shared["side"] as? String, state.side)
        let published = try XCTUnwrap(shared["navigationFrame"] as? [String: Double])
        XCTAssertEqual(CGFloat(try XCTUnwrap(published["x"])), back.toolbar.frame.minX, accuracy: 0.5)
        XCTAssertEqual(CGFloat(try XCTUnwrap(published["y"])), back.toolbar.frame.minY, accuracy: 0.5)
        XCTAssertEqual(CGFloat(try XCTUnwrap(published["width"])), back.toolbar.frame.width, accuracy: 0.5)
        XCTAssertEqual(CGFloat(try XCTUnwrap(published["height"])), back.toolbar.frame.height, accuracy: 0.5)
        let geometry = try XCTUnwrap(report["windowGeometry"] as? [String: Any])
        let dock = try XCTUnwrap(geometry["dockControls"] as? [String: Any])
        XCTAssertEqual(dock["status"] as? String, "available")
        XCTAssertEqual(dock["truncated"] as? Bool, false)
        let windowID = try XCTUnwrap(dock["windowID"] as? String)
        let controls = try XCTUnwrap(dock["controls"] as? [[String: Any]])
        for target in [back.control, save, home.control] {
            let matches = controls.filter { $0["identifier"] as? String == target.identifier }
            XCTAssertEqual(matches.count, 1)
            let control = try XCTUnwrap(matches.first)
            XCTAssertEqual(control["windowID"] as? String, windowID)
            XCTAssertEqual(control["sameWindow"] as? Bool, true)
            XCTAssertEqual(control["hostRole"] as? String, target.identifier == "next-visit-review-save" ? "page" : "navigation")
            for key in ["nativeFrameInWindow", "accessibilityFrameInScreen"] {
                let frame = try XCTUnwrap(control[key] as? [String: Double])
                XCTAssertEqual(CGFloat(try XCTUnwrap(frame["x"])), target.frame.minX, accuracy: 0.5)
                XCTAssertEqual(CGFloat(try XCTUnwrap(frame["y"])), target.frame.minY, accuracy: 0.5)
                XCTAssertEqual(CGFloat(try XCTUnwrap(frame["width"])), target.frame.width, accuracy: 0.5)
                XCTAssertEqual(CGFloat(try XCTUnwrap(frame["height"])), target.frame.height, accuracy: 0.5)
            }
        }
    }

    /// Compares native root and contextual rail/control frames in window coordinates.
    static func assertSameRailCenter(_ root: CGRect, contextualFrames: [CGRect]) {
        for frame in contextualFrames {
            XCTAssertEqual(root.midX, frame.midX, accuracy: 0.5,
                           "Root and contextual controls must share the measured UIWindow lane center")
        }
    }

    /// Preserve the same rail check, or independently check the real keyboard fallback after returning.
    @MainActor
    static func assertReturnNavigation(_ app: XCUIApplication, root: CGRect, rootState: NavigationSideState, returned: CGRect, citation: XCUIElement, testCase: XCTestCase) throws {
        let state = try observedNavigationSide(app, testCase: testCase)
        XCTAssertEqual(state.safeInsets, rootState.safeInsets)
        XCTAssertEqual(state.windowBounds, rootState.windowBounds)
        XCTAssertEqual(state.reservedRegions, rootState.reservedRegions)
        if state.side == rootState.side {
            assertSameRailCenter(root, contextualFrames: [returned])
            if state.keyboardVisible == rootState.keyboardVisible {
                return
            }
        }
        XCTAssertEqual(state.side, "bottom")
        XCTAssertTrue(rootState.side == "right" || rootState.side == "bottom")
        XCTAssertTrue(state.keyboardVisible, "A changed bottom state must expose the actual keyboard")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.exists && !keyboard.frame.isEmpty, app.debugDescription)
        XCTAssertLessThanOrEqual(returned.maxY, keyboard.frame.minY + 0.5, "The bottom navigation must clear the actual keyboard")
        for id in ["navigation-tab-ai", "navigation-tab-home"] {
            let target = try NavigationUITestConditions.navigationAction(app, id).control
            XCTAssertTrue(target.exists && target.isHittable && target.isEnabled, app.debugDescription)
            XCTAssertGreaterThanOrEqual(target.frame.width, 44)
            XCTAssertGreaterThanOrEqual(target.frame.height, 44)
            XCTAssertTrue(returned.insetBy(dx: -1, dy: -1).contains(target.frame))
            if id == "navigation-tab-ai" {
                XCTAssertTrue(target.isSelected)
            }
        }
        let input = UITestConditions.element(app, "rag-conversation-input")
        let composer = UITestConditions.element(app, "rag-conversation-composer")
        let send = app.buttons["rag-conversation-send"]
        for target in [input, send] {
            XCTAssertTrue(target.exists && target.isHittable, app.debugDescription)
            XCTAssertLessThanOrEqual(target.frame.maxY, returned.minY + 0.5, "The composer must clear bottom navigation")
        }
        XCTAssertTrue(citation.exists && citation.isHittable && composer.exists, app.debugDescription)
        XCTAssertLessThanOrEqual(citation.frame.maxY, composer.frame.minY + 0.5, "The last source must clear the composer")
    }

    /// Require the actual shared side and planner state to agree with UIKit and keyboard observation.
    @MainActor
    struct NavigationSideState {
        let side: String
        let keyboardVisible: Bool
        let safeInsets: [String: Double]
        let windowBounds: [String: Double]
        let reservedRegions: Data
    }

    static func observedNavigationSide(_ app: XCUIApplication, testCase: XCTestCase) throws -> NavigationSideState {
        let report = try XCTUnwrap(NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "navigation-side-state"))
        let lifecycle = try XCTUnwrap(report["lifecycle"] as? [[String: Any]])
        let frameEvent = try XCTUnwrap(lifecycle.last { $0["event"] as? String == "navigation-content-frame" })
        let frameText = try XCTUnwrap(frameEvent["frame"] as? String)
        let frame = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(frameText.utf8)) as? [String: Any])
        let side = try XCTUnwrap(frame["side"] as? String)
        let allocationEvent = try XCTUnwrap(lifecycle.last { $0["event"] as? String == "navigation-allocation" })
        let allocationText = try XCTUnwrap(allocationEvent["diagnostic"] as? String)
        let allocation = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(allocationText.utf8)) as? [String: Any])
        let right = try XCTUnwrap(allocation["isRightRail"] as? Bool)
        let keyboardVisible = try XCTUnwrap(allocation["keyboardVisible"] as? Bool)
        XCTAssertEqual(keyboardVisible, app.keyboards.firstMatch.exists)
        XCTAssertEqual(right, side == "right")
        if side == "bottom" {
            XCTAssertEqual(allocation["bottomStatus"] as? String, "ready")
        }
        let window = try XCTUnwrap(report["windowGeometry"] as? [String: Any])
        let safeInsets = try XCTUnwrap(window["safeAreaInsets"] as? [String: Double])
        let windowBounds = try XCTUnwrap(window["windowBounds"] as? [String: Double])
        let regions = try XCTUnwrap(window["reservedRegions"] as? [[String: Any]])
        let reservedRegions = try JSONSerialization.data(withJSONObject: regions, options: [.sortedKeys])
        return NavigationSideState(side: side, keyboardVisible: keyboardVisible, safeInsets: safeInsets, windowBounds: windowBounds, reservedRegions: reservedRegions)
    }
}
