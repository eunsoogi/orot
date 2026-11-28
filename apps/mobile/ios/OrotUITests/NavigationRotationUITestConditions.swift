import UIKit
import XCTest

/// Correlates native scene rotation with the history page and its actual AX window owner.
@MainActor
enum NavigationRotationUITestConditions {
    /// A changed app frame alone is not rotation proof; retain the native scene event and matching AX window.
    static func rotateObservedScene(_ app: XCUIApplication, session: String, landscape: Bool) throws -> [String: Any] {
        let scroll = UITestConditions.element(app, "conversation-history-page")
        let control = UITestConditions.element(app, "rotation-transition-request")

        func command(_ mode: String, timeout: TimeInterval = 15) throws -> [String: Any] {
            guard let owner = owningWindow(app, scroll: scroll, target: control) else {
                throw NSError(domain: "RotationWindowUnavailable", code: 1)
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

        // Wait for the actual history window to reflow before the probe's single read command.
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

    /// Read the existing test-only UIKit probe even when a focused editor disappears
    /// during AX re-projection. Native geometry alone never passes the recording test.
    static func rotateRecordingScene(
        _ app: XCUIApplication, session: String, landscape: Bool, initialAX: CGRect, testCase: XCTestCase,
        awaitOwnedAX: () -> RecordingFixtureUITestConditions.ReviewLayout?,
    ) throws -> RecordingFixtureUITestConditions.ReviewLayout {
        let controls = app.descendants(matching: .any).matching(identifier: "rotation-transition-request")
        let control = controls.firstMatch
        var previousSample = 0.0
        func command(_ mode: String) throws -> [String: Any] {
            let hittable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                controls.count == 1 && control.isHittable
            }, object: nil)
            guard XCTWaiter.wait(for: [hittable], timeout: 10) == .completed else {
                throw NSError(domain: "RecordingRotationControlUnavailable", code: 1)
            }
            control.tap()
            var receipt: [String: Any] = [:]
            let fresh = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard let value = try? JSONSerialization.jsonObject(with: Data(control.label.utf8)) as? [String: Any],
                      value["session"] as? String == session, value["mode"] as? String == mode,
                      let sampledAt = value["sampledAtMs"] as? Double, sampledAt > previousSample
                else { return false }
                previousSample = sampledAt; receipt = value
                return true
            }, object: nil)
            guard XCTWaiter.wait(for: [fresh], timeout: 10) == .completed else {
                throw NSError(domain: "RecordingRotationReceiptUnavailable", code: 1)
            }
            let evidence = try JSONSerialization.data(withJSONObject: receipt, options: .sortedKeys)
            let attachment = XCTAttachment(data: evidence, uniformTypeIdentifier: "public.json")
            attachment.name = "recording-scene-\(landscape ? "landscape" : "portrait")-\(mode)"
            attachment.lifetime = .keepAlways
            testCase.add(attachment)
            return receipt
        }

        let scroll = UITestConditions.element(app, "navigation-route-scroll")
        let controlOwner = try XCTUnwrap(owningWindow(app, scroll: scroll, target: control, reportFailure: false))
        XCTAssertEqual(controlOwner.frame, initialAX, "The rotation control must belong to the exact initial recording window.")
        let armed = try command("start")
        let scene = try XCTUnwrap(armed["sceneID"] as? String)
        let window = try XCTUnwrap(armed["windowID"] as? String)
        let generation = try XCTUnwrap(armed["generation"] as? Int)
        let started = try XCTUnwrap(armed["startedAtMs"] as? Double)
        let before = try XCTUnwrap(armed["current"] as? [String: Any])
        let initial = try XCTUnwrap(before["sceneOrientation"] as? Int)
        XCTAssertTrue(landscape ? initial == UIInterfaceOrientation.portrait.rawValue : UIInterfaceOrientation(rawValue: initial)?.isLandscape == true)
        XCUIDevice.shared.orientation = landscape ? .landscapeLeft : .portrait
        _ = try command(landscape ? "request" : "portrait")
        let ax = awaitOwnedAX()
        let receipt = try command("read")
        let bounds = try XCTUnwrap(receipt["windowBounds"] as? [String: Double])
        let width = try XCTUnwrap(bounds["width"]), height = try XCTUnwrap(bounds["height"])
        let current = try XCTUnwrap(receipt["current"] as? [String: Any])
        let orientation = try XCTUnwrap(current["sceneOrientation"] as? Int)
        let events = try XCTUnwrap(receipt["events"] as? [[String: Any]])
        XCTAssertEqual(receipt["status"] as? String, "sampled")
        XCTAssertEqual(receipt["sceneID"] as? String, scene)
        XCTAssertEqual(receipt["windowID"] as? String, window)
        XCTAssertEqual(receipt["generation"] as? Int, generation)
        XCTAssertTrue((receipt["error"] as? [String: Any])?.isEmpty == true)
        XCTAssertLessThanOrEqual(try XCTUnwrap(receipt["requestCount"] as? Int), 1)
        XCTAssertTrue(landscape ? UIInterfaceOrientation(rawValue: orientation)?.isLandscape == true : orientation == UIInterfaceOrientation.portrait.rawValue)
        XCTAssertTrue(events.contains { event in
            guard let observedAt = event["atMs"] as? Double, observedAt >= started,
                  let w = event["width"] as? Double, let h = event["height"] as? Double,
                  let transition = event["transition"] as? String, ["completed", "unavailable"].contains(transition),
                  event["cancelled"] as? Bool != true
            else { return false }
            return event["sceneID"] as? String == scene && event["windowID"] as? String == window &&
                event["sceneOrientation"] as? Int == orientation && abs(w - width) <= 0.5 && abs(h - height) <= 0.5
        }, "No settled native geometry event for the armed recording scene.")
        let layout = try XCTUnwrap(ax, "The settled native scene had no corroborating owned recording AX layout.")
        XCTAssertEqual(layout.window.width, width, accuracy: 0.5)
        XCTAssertEqual(layout.window.height, height, accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(owningWindow(app, scroll: scroll, target: control, reportFailure: false)).frame, layout.window)
        return layout
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
