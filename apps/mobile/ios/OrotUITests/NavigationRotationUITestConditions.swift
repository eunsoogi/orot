import UIKit
import XCTest

/// Correlates native scene rotation with the history page and its actual AX window owner.
@MainActor
enum NavigationRotationUITestConditions {
    /// A changed app frame alone is not rotation proof; retain the native scene event and matching AX window.
    static func rotateObservedScene(_ app: XCUIApplication, session: String, landscape: Bool) throws -> [String: Any] {
        let scroll = UITestConditions.element(app, "conversation-history-page")
        let control = UITestConditions.element(app, "rotation-transition-request")
        let sampleControl = UITestConditions.element(app, "rotation-transition-sample")

        func command(_ mode: String, sampleOnly: Bool = false, timeout: TimeInterval = 15) throws -> [String: Any] {
            let target = sampleOnly ? sampleControl : control
            guard let owner = owningWindow(app, scroll: scroll, target: target) else {
                throw NSError(domain: "RotationWindowUnavailable", code: 1)
            }
            XCTAssertTrue(target.isHittable, "Rotation control is not hittable in its owning window: \(owner.frame)")
            let previousSampleAt = (try? JSONSerialization.jsonObject(with: Data(target.label.utf8)) as? [String: Any])?["sampledAtMs"] as? Double
            target.tap()
            var receipt: [String: Any] = [:]
            let updated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard let value = try? JSONSerialization.jsonObject(with: Data(target.label.utf8)) as? [String: Any],
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

        XCUIDevice.shared.orientation = landscape ? .landscapeLeft : .portrait
        let requested = try command(landscape ? "request" : "portrait")
        XCTAssertEqual(requested["status"] as? String, "sampled")
        let expectedOrientation = landscape ? UIInterfaceOrientation.landscapeLeft.rawValue : UIInterfaceOrientation.portrait.rawValue
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
        let receiptDeadline = Date().addingTimeInterval(15)
        var receipt = try command("read", timeout: max(0.001, receiptDeadline.timeIntervalSinceNow))
        while !hasCorrelatedGeometry(receipt) {
            let remaining = receiptDeadline.timeIntervalSinceNow
            guard remaining > 0 else { break }
            receipt = try command("read", sampleOnly: true, timeout: remaining)
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
