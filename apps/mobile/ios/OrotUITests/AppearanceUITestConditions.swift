import CoreFoundation
import XCTest

@MainActor
enum AppearanceUITestConditions {
    private static let session = UUID().uuidString
    static let observationArguments = ["-OROT_TEST_APPEARANCE_OBSERVATION", "YES", "-OROT_TEST_APPEARANCE_SESSION", session]

    struct Snapshot {
        let appearance: XCUIDevice.Appearance
        let applicationScheme: String
        let originalOverride: Int
    }

    /// Change the owned device's system style through XCTest while retaining the app process and its unsaved state.
    static func select(_ dark: Bool, returningTo app: XCUIApplication, testCase: XCTestCase,
                       captureOriginal: ((Snapshot) -> Void)? = nil) throws -> Snapshot
    {
        let marker = UITestConditions.element(app, "application-appearance-observation")
        XCTAssertTrue(UITestConditions.exists(marker))
        let original = UITestConditions.text(marker)
        XCTAssertTrue(["light", "dark"].contains(original), original)
        let refresh = readyObservation(app)
        let snapshot = Snapshot(appearance: XCUIDevice.shared.appearance, applicationScheme: original,
                                originalOverride: refreshObservation(refresh)["originalOverrideStyle"] as? Int ?? -1)
        // Record recovery state before the first mutation, including when a later assertion ends the test.
        captureOriginal?(snapshot)
        try apply(dark ? .dark : .light, applicationScheme: dark ? "dark" : "light", expectedOverride: dark ? 2 : 1,
                  to: app, testCase: testCase, stage: "selected")
        return snapshot
    }

    static func restore(_ snapshot: Snapshot, returningTo app: XCUIApplication, testCase: XCTestCase) throws {
        try apply(snapshot.appearance, applicationScheme: snapshot.applicationScheme, expectedOverride: snapshot.originalOverride,
                  to: app, testCase: testCase, stage: "restored")
    }

    /// Refresh the existing test window from the public device readback without Settings, process restart, or direct JS theme substitution.
    private static func apply(_ appearance: XCUIDevice.Appearance, applicationScheme: String, expectedOverride: Int, to app: XCUIApplication,
                              testCase: XCTestCase, stage: String) throws
    {
        XCTAssertEqual(app.state, .runningForeground)
        let previous = XCUIDevice.shared.appearance
        let refreshMarker = readyObservation(app)
        let previousRefresh = refreshObservation(refreshMarker)["appliedCount"] as? Int ?? 0
        XCUIDevice.shared.appearance = appearance
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            XCUIDevice.shared.appearance == appearance
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed)
        let observed = XCUIDevice.shared.appearance
        XCTAssertTrue([XCUIDevice.Appearance.light, .dark].contains(observed))
        let command = stage == "restored" ? "restore" : (observed == .dark ? "dark" : "light")
        let name = CFNotificationName("com.orot.tests.appearance.\(session).\(command)" as CFString)
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
        // The acknowledgement and independent application subscription must both change; an API readback alone cannot pass.
        let marker = UITestConditions.element(app, "application-appearance-observation")
        let applicationChanged = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let refresh = refreshObservation(refreshMarker)
            return marker.exists && UITestConditions.text(marker) == applicationScheme &&
                refresh["status"] as? String == "refreshed" && (refresh["appliedCount"] as? Int ?? 0) > previousRefresh &&
                refresh["windowStyle"] as? Int == (applicationScheme == "dark" ? 2 : 1) &&
                refresh["overrideStyle"] as? Int == expectedOverride
        }, object: nil)
        let applicationResult = XCTWaiter.wait(for: [applicationChanged], timeout: 10)
        let evidence: [String: Any] = [
            "stage": stage, "previous": previous.rawValue, "requested": appearance.rawValue,
            "observed": XCUIDevice.shared.appearance.rawValue, "appState": app.state.rawValue,
            "expectedApplicationScheme": applicationScheme, "applicationScheme": UITestConditions.text(marker),
            "refresh": refreshObservation(refreshMarker),
        ]
        let record = try XCTAttachment(data: JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]),
                                       uniformTypeIdentifier: "public.json")
        record.name = "system-appearance-\(stage)"
        record.lifetime = .keepAlways
        testCase.add(record)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "system-appearance-\(appearance.rawValue)-\(stage)"
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
        XCTAssertEqual(applicationResult, .completed, "Expected application appearance \(applicationScheme), observed \(UITestConditions.text(marker))")
        XCTAssertEqual(refreshObservation(refreshMarker)["windowStyle"] as? Int, applicationScheme == "dark" ? 2 : 1)
        XCTAssertEqual(refreshObservation(refreshMarker)["overrideStyle"] as? Int, expectedOverride)
        XCTAssertEqual(app.state, .runningForeground)
    }

    private static func refreshObservation(_ marker: XCUIElement) -> [String: Any] {
        guard marker.exists, let data = UITestConditions.text(marker).data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return value
    }

    /// Observe registration before sending the one-way signal so no command can be lost during bridge startup.
    private static func readyObservation(_ app: XCUIApplication) -> XCUIElement {
        let marker = UITestConditions.element(app, "application-appearance-refresh")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let value = refreshObservation(marker)
            return value["status"] as? String == "refreshed" && value["session"] as? String == session
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed, app.debugDescription)
        return marker
    }
}
