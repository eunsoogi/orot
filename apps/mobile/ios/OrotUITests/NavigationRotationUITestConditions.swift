import UIKit
import XCTest

/// Correlates native scene rotation with the selected scroll surface and its actual AX window owner.
@MainActor
enum NavigationRotationUITestConditions {
    /// A changed app frame alone is not rotation proof; retain the native scene event and matching AX window.
    static func rotateObservedScene(
        _ app: XCUIApplication, session: String, landscape: Bool,
        scrollID: String = "conversation-history-page", syntheticProtectedContent: [XCUIElement]? = nil,
    ) throws -> [String: Any] {
        let scroll = UITestConditions.element(app, scrollID)
        let controlID = syntheticProtectedContent != nil ? "synthetic-safe-rotation-transition-request" : "rotation-transition-request"
        let control = UITestConditions.element(app, controlID)

        func command(_ mode: String, timeout: TimeInterval = 15) throws -> [String: Any] {
            guard let owner = owningWindow(app, scroll: scroll, target: control) else {
                throw NSError(domain: "RotationWindowUnavailable", code: 1)
            }
            if let syntheticProtectedContent {
                try validateSyntheticHeaderProbe(app, control: control, owner: owner, protectedContent: syntheticProtectedContent)
            }
            XCTAssertTrue(control.isHittable, "Rotation control is not hittable in its owning window: \(owner.frame)")
            let previousSampleAt = (try? JSONSerialization.jsonObject(with: Data(control.label.utf8)) as? [String: Any])?["sampledAtMs"] as? Double
            control.tap()
            var receipt: [String: Any] = [:]
            let updated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard let value = try? JSONSerialization.jsonObject(with: Data(control.label.utf8)) as? [String: Any],
                      value["session"] as? String == session,
                      value["mode"] as? String == mode,
                      value["status"] as? String == "sampled",
                      let sampleAt = value["sampledAtMs"] as? Double,
                      previousSampleAt.map({ sampleAt > $0 }) ?? true else { return false }
                receipt = value
                return true
            }, object: nil)
            guard XCTWaiter.wait(for: [updated], timeout: timeout) == .completed else {
                throw NSError(domain: "RotationReceiptUnavailable", code: 1)
            }
            return receipt
        }

        guard let initialOwner = owningWindow(app, scroll: scroll, target: control) else {
            throw NSError(domain: "RotationWindowUnavailable", code: 2)
        }
        XCTAssertTrue(scroll.exists && control.exists)
        let initial = initialOwner.frame
        let armed = try command("start")
        XCTAssertEqual(armed["status"] as? String, "sampled")
        let before = try XCTUnwrap(armed["before"] as? [String: Any])
        XCTAssertEqual(before["sceneOrientation"] as? Int, UIInterfaceOrientation.portrait.rawValue)

        // UIKit maps a left-facing device orientation to landscapeRight in the app scene.
        let expectedOrientation = landscape
            ? UIInterfaceOrientation.landscapeRight.rawValue
            : UIInterfaceOrientation.portrait.rawValue
        XCUIDevice.shared.orientation = landscape ? .landscapeLeft : .portrait
        let requested = try command(landscape ? "request" : "portrait")
        XCTAssertEqual(requested["status"] as? String, "sampled")

        // Wait for the actual owning window to reflow before the probe's single read command.
        let reflowed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard scroll.exists, control.exists,
                  let owner = owningWindow(app, scroll: scroll, target: control, reportFailure: false) else { return false }
            let frame = owner.frame
            return (abs(frame.width - initial.width) > 0.5 || abs(frame.height - initial.height) > 0.5) &&
                (landscape ? frame.width > frame.height : frame.height > frame.width)
        }, object: nil)
        guard XCTWaiter.wait(for: [reflowed], timeout: 15) == .completed else {
            throw NSError(domain: "HistoryWindowReflowUnavailable", code: 1)
        }

        // The shared probe advances on each press, so one post-reflow read preserves this generation.
        let receipt = try command("read")
        func hasCorrelatedGeometry(_ value: [String: Any]) -> Bool {
            guard value["status"] as? String == "sampled",
                  value["session"] as? String == session,
                  value["sceneID"] as? String == armed["sceneID"] as? String,
                  value["windowID"] as? String == armed["windowID"] as? String,
                  value["generation"] as? Int == armed["generation"] as? Int,
                  let requestCount = value["requestCount"] as? Int, requestCount <= 1,
                  (value["error"] as? [String: Any])?.isEmpty == true,
                  let bounds = value["windowBounds"] as? [String: Double],
                  let current = value["current"] as? [String: Any],
                  current["sceneOrientation"] as? Int == expectedOrientation,
                  let events = value["events"] as? [[String: Any]] else { return false }
            return events.contains { event in
                guard let width = event["width"] as? Double, let height = event["height"] as? Double else { return false }
                return event["sceneID"] as? String == value["sceneID"] as? String &&
                    event["windowID"] as? String == value["windowID"] as? String &&
                    event["sceneOrientation"] as? Int == expectedOrientation &&
                    abs(width - (bounds["width"] ?? 0)) <= 0.5 && abs(height - (bounds["height"] ?? 0)) <= 0.5 &&
                    (landscape ? width > height : height > width)
            }
        }
        XCTAssertTrue(hasCorrelatedGeometry(receipt), "No settled native scene geometry receipt: \(receipt)")
        let receiptData = try JSONSerialization.data(withJSONObject: receipt, options: .sortedKeys)
        XCTContext.runActivity(named: "Scene geometry receipt") { activity in
            let attachment = XCTAttachment(data: receiptData, uniformTypeIdentifier: "public.json")
            attachment.name = landscape ? "scene-geometry-landscape" : "scene-geometry-portrait"
            attachment.lifetime = .keepAlways
            activity.add(attachment)
        }

        XCTAssertEqual(receipt["status"] as? String, "sampled")
        XCTAssertEqual(receipt["session"] as? String, session)
        XCTAssertEqual(receipt["sceneID"] as? String, armed["sceneID"] as? String)
        XCTAssertEqual(receipt["windowID"] as? String, armed["windowID"] as? String)
        XCTAssertEqual(receipt["generation"] as? Int, armed["generation"] as? Int)
        XCTAssertTrue((receipt["error"] as? [String: Any])?.isEmpty == true)
        XCTAssertLessThanOrEqual(try XCTUnwrap(receipt["requestCount"] as? Int), 1)

        let current = try XCTUnwrap(receipt["windowBounds"] as? [String: Double])
        let currentGeometry = try XCTUnwrap(receipt["current"] as? [String: Any])
        XCTAssertEqual(currentGeometry["sceneOrientation"] as? Int, expectedOrientation)
        let events = try XCTUnwrap(receipt["events"] as? [[String: Any]])
        let eventMatchesCurrentScene = events.contains { event in
            guard let width = event["width"] as? Double, let height = event["height"] as? Double else { return false }
            return event["sceneID"] as? String == receipt["sceneID"] as? String &&
                event["windowID"] as? String == receipt["windowID"] as? String &&
                event["sceneOrientation"] as? Int == expectedOrientation &&
                abs(width - (current["width"] ?? 0)) <= 0.5 && abs(height - (current["height"] ?? 0)) <= 0.5 &&
                (landscape ? width > height : height > width)
        }
        XCTAssertTrue(eventMatchesCurrentScene, "No correlated current scene geometry event: \(receipt)")

        let bounds = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard scroll.exists, control.exists,
                  let owner = owningWindow(app, scroll: scroll, target: control, reportFailure: false) else { return false }
            let frame = owner.frame
            return (abs(frame.width - initial.width) > 0.5 || abs(frame.height - initial.height) > 0.5) &&
                abs(frame.width - (current["width"] ?? 0)) <= 0.5 && abs(frame.height - (current["height"] ?? 0)) <= 0.5 &&
                (landscape ? frame.width > frame.height : frame.height > frame.width)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [bounds], timeout: 15), .completed, "AX window did not reflow")
        _ = try XCTUnwrap(owningWindow(app, scroll: scroll, target: control))
        return receipt
    }

    /// Check the actual UIKit hit rectangle before every physical probe tap, including across reflow.
    private static func validateSyntheticHeaderProbe(
        _ app: XCUIApplication, control: XCUIElement, owner: XCUIElement, protectedContent: [XCUIElement],
    ) throws {
        let frame = control.frame
        let ownerFrame = owner.frame
        let coversProductControl = (app.buttons.allElementsBoundByIndex + protectedContent).contains { element in
            element.identifier != control.identifier && element.exists && element.frame.intersects(frame)
        }
        guard ownerFrame.contains(frame), frame.minY >= ownerFrame.minY + 64,
              abs(frame.width - 44) <= 0.5, abs(frame.height - 44) <= 0.5,
              control.isHittable, !coversProductControl
        else {
            throw NSError(domain: "SyntheticRotationProbeUnsafe", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Rotation probe \(frame) would not hit an inert safe header in \(ownerFrame)",
            ])
        }
    }

    /// Same test-entry bridge snapshot, retaining only ordered synthetic events and its sample boundary.
    struct ScrollTrace {
        let observer: String
        let startedAtMs: Double
        let events: [[String: Any]]
    }

    static func readSyntheticScrollTrace(_ app: XCUIApplication) -> ScrollTrace? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        guard marker.exists,
              let snapshot = (try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8))) as? [String: Any],
              let observer = snapshot["observerID"] as? String, !observer.isEmpty,
              let routeState = snapshot["routeState"] as? [String: Any],
              let started = routeState["startedAtMs"] as? Double, started.isFinite,
              let events = snapshot["lifecycle"] as? [[String: Any]] else { return nil }
        let trace = events.filter { $0["event"] as? String == "synthetic-transcript-scroll" }
        return trace.isEmpty ? nil : ScrollTrace(observer: observer, startedAtMs: started, events: trace)
    }

    @discardableResult
    static func attachSyntheticScrollTrace(
        _ app: XCUIApplication, testCase: XCTestCase, name: String, trace: ScrollTrace? = nil,
    ) -> ScrollTrace? {
        let sample = trace ?? readSyntheticScrollTrace(app)
        var payload: [String: Any] = ["available": sample != nil, "events": sample?.events ?? []]
        payload["startedAtMs"] = sample?.startedAtMs
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "synthetic-transcript-scroll-\(name)"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        return sample
    }

    /// Resolves the unique AX window that contains both the page scroll region and the probe control.
    private static func owningWindow(
        _ app: XCUIApplication, scroll: XCUIElement, target: XCUIElement, reportFailure: Bool = true,
    ) -> XCUIElement? {
        let windows = app.windows.allElementsBoundByIndex.filter(\.exists)
        guard scroll.exists, target.exists, !scroll.identifier.isEmpty, !target.identifier.isEmpty else {
            if reportFailure {
                XCTFail("The history page and rotation control need stable accessibility identifiers")
            }
            return nil
        }
        let scrollCounts = windows.map { $0.descendants(matching: .any).matching(identifier: scroll.identifier).count }
        let targetCounts = windows.map { $0.descendants(matching: .any).matching(identifier: target.identifier).count }
        guard let index = matchingOwnerIndex(scrollCounts: scrollCounts, targetCounts: targetCounts) else {
            if reportFailure {
                XCTFail("No unique AX window owns the history page and rotation control")
            }
            return nil
        }
        return windows[index]
    }

    /// Requires each identified view to occur in exactly one window, with the same owner.
    private static func matchingOwnerIndex(scrollCounts: [Int], targetCounts: [Int]) -> Int? {
        guard scrollCounts.count == targetCounts.count,
              let scrollOwner = uniqueOwnerIndex(scrollCounts),
              uniqueOwnerIndex(targetCounts) == scrollOwner else { return nil }
        return scrollOwner
    }

    /// Rejects both missing matches and duplicate occurrences in any candidate window.
    private static func uniqueOwnerIndex(_ counts: [Int]) -> Int? {
        let owners = counts.indices.filter { counts[$0] > 0 }
        guard owners.count == 1, let index = owners.first, counts[index] == 1 else { return nil }
        return index
    }
}
