import UIKit
import XCTest

/// Resolves the form's AX window independently from keyboard windows and app envelopes.
@MainActor
enum FormWindowOwnership {
    static func resolve(
        _ app: XCUIApplication, scroll: XCUIElement, target: XCUIElement, reportFailure: Bool = true,
    ) -> XCUIElement? {
        let windows = app.windows.allElementsBoundByIndex.filter(\.exists)
        let scrollID = scroll.identifier
        let targetExists = target.exists
        let targetID = targetExists ? target.identifier : ""
        // Without identifiers, ownership cannot be disambiguated across windows.
        if scrollID.isEmpty || (targetExists && targetID.isEmpty) {
            guard windows.count == 1 else {
                if reportFailure {
                    XCTFail("The form window owner is ambiguous: windows=\(windows.count)")
                }
                return nil
            }
            return windows[0]
        }
        func counts(_ identifier: String) -> [Int] {
            windows.map { $0.descendants(matching: .any).matching(identifier: identifier).count }
        }
        let scrollCounts = counts(scrollID)
        let targetCounts = targetExists ? counts(targetID) : nil
        guard let index = FormScrollGeometry.matchingOwnerIndex(scrollCounts: scrollCounts, targetCounts: targetCounts) else {
            if reportFailure {
                let frames = windows.map(\.frame)
                XCTFail("Form ownership unavailable: frames=\(frames), scrollCounts=\(scrollCounts), targetCounts=\(String(describing: targetCounts))")
            }
            return nil
        }
        return windows[index]
    }

    /// A second AX window is tolerated only if all real stage markers independently identify another single owner.
    static func resolveStage(_ app: XCUIApplication, observed: CGRect?, required: [String]) throws -> XCUIElement {
        let windows = app.windows.allElementsBoundByIndex.filter(\.exists)
        guard windows.count <= 8 else { throw StageWindowError.unbounded }
        let frames = windows.map(\.frame)
        func count(_ id: String, in element: XCUIElement) -> Int {
            element.descendants(matching: .any).matching(identifier: id).count
        }
        let total = required.map { count($0, in: app) }
        let counts = required.map { id in windows.map { count(id, in: $0) } }
        XCTContext.runActivity(named: "Stage AX owners: frames=\(frames), globalCounts=\(total), countsByMarker=\(counts)") { _ in }
        guard total.allSatisfy({ $0 == 1 }),
              let owner = FormScrollGeometry.stageOwnerIndex(frames: frames, observed: observed, counts: counts)
        else { throw StageWindowError.missingOrAmbiguous }
        return windows[owner]
    }

    private enum StageWindowError: Error {
        case unbounded
        case missingOrAmbiguous
    }
}

struct ClassificationStageWindowAnchor {
    let windowID: String
    let sceneID: String
    let frame: CGRect
}

extension AppointmentConsentUITests {
    /// UIKit window traits and XCUI stage rectangles are observations, not assumed Duo/XXXL values.
    @discardableResult
    @MainActor
    func captureStageLayout(_ app: XCUIApplication, stage: String, anchor: ClassificationStageWindowAnchor? = nil, settled: CGRect? = nil, measuredProgress: NSPredicate? = nil) throws -> ClassificationStageWindowAnchor {
        let tokens = ["medical-appointment-confirmation", "medical-appointment-progress", "medical-appointment-results"]
        let phase = stage.hasPrefix("progress-") ? 1 : stage.hasPrefix("result-") ? 2 : 0
        var actions = phase == 1 ? ["classification-release-response"] : ["medical-appointment-previous-result", "medical-appointment-import", "medical-appointment-next-result"]
        if phase == 0 {
            actions.append("medical-appointment-select-provider")
        }
        let required = ["medical-appointment-fullscreen", tokens[phase]] + (phase == 1 ? [] : ["classification-stage-footer", "classification-text-viewport"]) + actions + (phase == 2 ? ["classification-page-text"] : [])
        let markerID = "classification-layout-receipt"
        let counterID = "calendar-classification-synthetic-provider-calls"
        let scopedIDs = required + [markerID, counterID]
        let before = try FormWindowOwnership.resolveStage(app, observed: anchor?.frame ?? settled, required: scopedIDs)
        let beforeFrame = before.frame
        func scoped(_ window: XCUIElement, _ id: String) -> XCUIElement {
            window.descendants(matching: .any).matching(identifier: id).firstMatch
        }
        let marker = scoped(before, markerID)
        let counter = scoped(before, counterID)
        let previous = UITestConditions.text(marker)
        XCTAssertTrue(counter.isHittable && FormScrollGeometry.valid(counter.frame) && beforeFrame.contains(counter.frame))
        let requested = Date().timeIntervalSince1970 * 1000
        counter.tap()
        let fresh = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            marker.exists && UITestConditions.text(marker) != previous
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [fresh]), .completed)
        // The invisible receipt establishes ownership only, not an interactive hit rectangle.
        let owner = try FormWindowOwnership.resolveStage(app, observed: beforeFrame, required: scopedIDs)
        let value = UITestConditions.text(scoped(owner, markerID))
        XCTAssertNotEqual(value, previous)
        let data = Data(value.utf8)
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(report["requestedAtMs"] as? Double), requested)
        let started = try XCTUnwrap(report["sampleStartedAtMs"] as? Double)
        let ended = try XCTUnwrap(report["sampleEndedAtMs"] as? Double)
        XCTAssertTrue(started.isFinite && ended.isFinite)
        XCTAssertGreaterThanOrEqual(started, try XCTUnwrap(report["requestedAtMs"] as? Double))
        XCTAssertGreaterThanOrEqual(ended, started)
        XCTAssertLessThanOrEqual(ended, Date().timeIntervalSince1970 * 1000)
        let dockStarted = try XCTUnwrap(report["dockSampleStartedAtMs"] as? Double)
        let dockEnded = try XCTUnwrap(report["dockSampleEndedAtMs"] as? Double)
        XCTAssertTrue(dockStarted.isFinite && dockEnded.isFinite)
        XCTAssertGreaterThanOrEqual(dockStarted, ended)
        XCTAssertGreaterThanOrEqual(dockEnded, dockStarted)
        XCTAssertLessThanOrEqual(dockEnded, Date().timeIntervalSince1970 * 1000)
        XCTAssertEqual(report["visibleKeyWindowCount"] as? Int, 1)
        let category = try XCTUnwrap(report["contentSizeCategory"] as? String)
        XCTAssertFalse(category.isEmpty)
        let insets = try XCTUnwrap(report["safeAreaInsets"] as? [String: Double])
        for key in ["top", "right", "bottom", "left"] {
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(insets[key]), 0)
        }
        let native = try XCTUnwrap(report["windowFrameInScreen"] as? [String: Double])
        let frame = try CGRect(x: XCTUnwrap(native["x"]), y: XCTUnwrap(native["y"]), width: XCTUnwrap(native["width"]), height: XCTUnwrap(native["height"]))
        let current = try ClassificationStageWindowAnchor(windowID: XCTUnwrap(report["windowID"] as? String), sceneID: XCTUnwrap(report["sceneID"] as? String), frame: frame)
        if let anchor {
            XCTAssertEqual(current.windowID, anchor.windowID)
            XCTAssertEqual(current.sceneID, anchor.sceneID)
            XCTAssertTrue(FormScrollGeometry.stableStageFrame(frame, anchor.frame))
        }
        if let settled {
            XCTAssertTrue(FormScrollGeometry.stableStageFrame(frame, settled))
        }
        for id in tokens where id != tokens[phase] {
            XCTAssertFalse(node(app, id).exists, "Unexpected second classification stage: \(id)")
        }
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(owner.frame, frame))
        var receipt = report
        if let measuredProgress {
            let matches = owner.descendants(matching: .any).matching(measuredProgress)
            XCTAssertEqual(app.descendants(matching: .any).matching(measuredProgress).count, 1)
            XCTAssertEqual(matches.count, 1)
            let progressFrame = matches.firstMatch.frame
            XCTAssertTrue(FormScrollGeometry.valid(progressFrame) && owner.frame.contains(progressFrame))
            receipt["progressFrame"] = ViewportObservation.rect(progressFrame)
        }
        var frames = ["window": ViewportObservation.rect(owner.frame)]
        var stageFrames: [String: CGRect] = [:]
        for id in required {
            let target = owner.descendants(matching: .any).matching(identifier: id).firstMatch
            let targetFrame = target.frame
            XCTAssertTrue(target.exists && FormScrollGeometry.valid(targetFrame) && owner.frame.insetBy(dx: -1, dy: -1).contains(targetFrame))
            if actions.contains(id) {
                XCTAssertGreaterThanOrEqual(targetFrame.height, 44)
                if phase != 1 {
                    XCTAssertGreaterThanOrEqual(targetFrame.width, 44)
                }
                if target.isEnabled {
                    XCTAssertTrue(target.isHittable)
                }
            }
            frames[id] = ViewportObservation.rect(targetFrame)
            if id == tokens[phase] || id == "medical-appointment-fullscreen" {
                stageFrames[id] = targetFrame
            }
        }
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(owner.frame, frame))
        for (id, observed) in stageFrames {
            let target = owner.descendants(matching: .any).matching(identifier: id).firstMatch
            XCTAssertTrue(target.exists && FormScrollGeometry.stableStageFrame(target.frame, observed))
        }
        receipt["stage"] = stage
        receipt["xcuiFrames"] = frames
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: receipt), uniformTypeIdentifier: "public.json")
        attachment.name = "classification-layout-\(stage)"
        attachment.lifetime = .keepAlways
        add(attachment)
        // Settings and stage changes must not silently fall back to a narrow window or smaller text.
        if app.launchArguments.contains("-OROT_TEST_CLASSIFICATION_STAGE_SCENE") {
            XCTAssertGreaterThan(frame.width, frame.height, "Expected an actual wide stage: \(stage)")
            XCTAssertEqual(category, UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue)
        }
        return current
    }
}
