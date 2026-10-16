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

    /// One rendered receipt retains the independent RN subscription beside UIKit's acknowledgement.
    struct Observation: Codable {
        let session: String
        let status: String
        let command: String
        let appliedCount: Int
        let applicationScheme: String
        let windowStyle: Int
        let overrideStyle: Int
        let originalOverrideStyle: Int

        func matches(session expectedSession: String, command expectedCommand: String, scheme: String,
                     after previousCount: Int, override expectedOverride: Int, originalOverride: Int) -> Bool
        {
            status == "refreshed" && session == expectedSession && command == expectedCommand &&
                appliedCount > previousCount && ["light", "dark"].contains(scheme) && applicationScheme == scheme &&
                windowStyle == (scheme == "dark" ? 2 : 1) && overrideStyle == expectedOverride &&
                originalOverrideStyle == originalOverride
        }
    }

    static func decodeObservation(_ label: String) -> Observation? {
        guard let data = label.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Observation.self, from: data)
    }

    /// Change the owned device's system style through XCTest while retaining the app process and its unsaved state.
    static func select(_ dark: Bool, returningTo app: XCUIApplication, testCase: XCTestCase,
                       captureOriginal: ((Snapshot) -> Void)? = nil) throws -> Snapshot
    {
        let (_, original) = try readyObservation(app)
        let snapshot = Snapshot(appearance: XCUIDevice.shared.appearance, applicationScheme: original.applicationScheme,
                                originalOverride: original.originalOverrideStyle)
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
        let (refreshMarker, previousObservation) = try readyObservation(app)
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
        // One typed AX snapshot per evaluation avoids six synchronous reads and mixed-time observations.
        // The native acknowledgement still cannot pass without the independently observed application scheme.
        var lastObservation: Observation?
        let observationStarted = ProcessInfo.processInfo.systemUptime
        var observationElapsed: TimeInterval = 0
        let applicationChanged = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            lastObservation = readObservation(refreshMarker)
            observationElapsed = ProcessInfo.processInfo.systemUptime - observationStarted
            // An AX call can block beyond XCTest's waiter budget; a late matching receipt is still a failure.
            return observationElapsed <= 10 && lastObservation?.matches(
                session: session, command: command, scheme: applicationScheme, after: previousObservation.appliedCount,
                override: expectedOverride, originalOverride: previousObservation.originalOverrideStyle,
            ) == true
        }, object: nil)
        let applicationResult = XCTWaiter.wait(for: [applicationChanged], timeout: 10)
        let evidence: [String: Any] = try [
            "stage": stage, "previous": previous.rawValue, "requested": appearance.rawValue,
            "observed": XCUIDevice.shared.appearance.rawValue, "appState": app.state.rawValue,
            "expectedApplicationScheme": applicationScheme, "applicationScheme": lastObservation?.applicationScheme ?? "unobserved",
            "observationElapsedSeconds": observationElapsed,
            "refresh": lastObservation.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull(),
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
        XCTAssertEqual(applicationResult, .completed, "Expected application appearance \(applicationScheme), last observed \(lastObservation?.applicationScheme ?? "unobserved")")
        XCTAssertEqual(lastObservation?.windowStyle, applicationScheme == "dark" ? 2 : 1)
        XCTAssertEqual(lastObservation?.overrideStyle, expectedOverride)
        XCTAssertEqual(app.state, .runningForeground)
    }

    private static func readObservation(_ marker: XCUIElement) -> Observation? {
        guard let snapshot = try? marker.snapshot() else { return nil }
        return decodeObservation(snapshot.label)
    }

    /// Observe registration before sending the one-way signal so no command can be lost during bridge startup.
    private static func readyObservation(_ app: XCUIApplication) throws -> (XCUIElement, Observation) {
        let marker = app.staticTexts.matching(identifier: "application-appearance-refresh").firstMatch
        var observation: Observation?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            observation = readObservation(marker)
            guard let observation else { return false }
            return observation.status == "refreshed" && observation.session == session && observation.appliedCount >= 0 &&
                ["light", "dark"].contains(observation.applicationScheme) && (0 ... 2).contains(observation.originalOverrideStyle)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed, "Appearance observation must register the owned session")
        return try (marker, XCTUnwrap(observation))
    }
}
