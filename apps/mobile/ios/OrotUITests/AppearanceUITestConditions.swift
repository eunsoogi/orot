import UIKit
import XCTest

@MainActor
enum AppearanceUITestConditions {
    struct Snapshot {
        let dark: Bool
        let automatic: Bool
    }

    /// Change the dedicated Simulator's real system preference while retaining the target app process and restore it afterward.
    static func select(_ dark: Bool, returningTo app: XCUIApplication, testCase: XCTestCase,
                       captureOriginal: ((Snapshot) -> Void)? = nil) throws -> Snapshot
    {
        XCTAssertNotEqual(app.state, .notRunning)
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        // launch() terminates a running Settings instance. Reuse the owned English session instead; the actual controls below still verify its language and appearance state.
        if settings.state == .notRunning {
            settings.launch()
        } else {
            settings.activate()
        }
        XCTAssertEqual(settings.state, .runningForeground, settings.debugDescription)
        // The pinned iOS 27 controls combine their sample clock and mode in one accessible label.
        let light = settings.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "Light")).firstMatch
        let darkButton = settings.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "Dark")).firstMatch
        if !light.exists || !darkButton.exists {
            // The pinned iOS 27 Settings app exposes a locale-independent identifier for its Appearance route.
            let display = settings.buttons["com.apple.settings.appearance"]
            // A previous Settings session can reopen its root at the old scroll offset.
            for _ in 0 ..< 4 where !display.exists || !display.isHittable {
                settings.swipeDown()
            }
            UITestConditions.scrollTo(display, in: settings)
            display.tap()
        }
        XCTAssertTrue(UITestConditions.exists(light), settings.debugDescription)
        XCTAssertTrue(UITestConditions.exists(darkButton), settings.debugDescription)
        let automatic = settings.switches["Automatic"]
        XCTAssertTrue(UITestConditions.exists(automatic), settings.debugDescription)
        XCTAssertNotEqual(light.isSelected, darkButton.isSelected, settings.debugDescription)
        let automaticValue = try XCTUnwrap(automatic.value as? String)
        XCTAssertTrue(["0", "1"].contains(automaticValue), automatic.debugDescription)
        let snapshot = Snapshot(dark: darkButton.isSelected, automatic: automaticValue == "1")
        // Record recovery state before the first mutation, including when a later assertion ends the test.
        captureOriginal?(snapshot)
        let selected = dark ? darkButton : light
        selected.tap()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in selected.isSelected }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed, settings.debugDescription)
        let attachment = XCTAttachment(screenshot: settings.screenshot())
        attachment.name = dark ? "system-dark-appearance-selected" : "system-light-appearance-selected"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        settledWindow(app)
        return snapshot
    }

    static func restore(_ snapshot: Snapshot, returningTo app: XCUIApplication, testCase: XCTestCase) throws {
        _ = try select(snapshot.dark, returningTo: app, testCase: testCase)
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.activate()
        let automatic = settings.switches["Automatic"]
        XCTAssertTrue(UITestConditions.exists(automatic))
        if (automatic.value as? String == "1") != snapshot.automatic {
            automatic.tap()
        }
        XCTAssertEqual(automatic.value as? String == "1", snapshot.automatic)
        app.activate()
        settledWindow(app)
    }

    /// Foreground state precedes the native activation animation; require the actual window to occupy the Simulator screen before inspecting controls.
    private static func settledWindow(_ app: XCUIApplication) {
        let bounds = UIScreen.main.bounds
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let window = app.windows.firstMatch
            guard window.exists else { return false }
            let frame = window.frame
            return abs(frame.minX - bounds.minX) <= 1 && abs(frame.minY - bounds.minY) <= 1 &&
                abs(frame.width - bounds.width) <= 1 && abs(frame.height - bounds.height) <= 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed, app.debugDescription)
    }
}
