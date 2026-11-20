import XCTest

/// Runs shared geometry checks independently of the export journey.
final class FormScrollGeometryUITests: XCTestCase {
    @MainActor
    func testFormGestureBoundaries() throws {
        try FormScrollGeometryRegression.verify()
        try verifyActionDockOcclusion()
        try verifyDisclosureReadingEdges()
        verifyClassificationStageOwner()
        verifyClassificationStartAction()
        XCTAssertEqual(FormScrollGeometry.uniqueOwnerIndex([1, 0]), 0)
        XCTAssertEqual(FormScrollGeometry.uniqueOwnerIndex([0, 1]), 1)
        XCTAssertNil(FormScrollGeometry.uniqueOwnerIndex([0, 0]))
        XCTAssertNil(FormScrollGeometry.uniqueOwnerIndex([1, 1]))
        XCTAssertNil(FormScrollGeometry.uniqueOwnerIndex([2, 0]))
        XCTAssertEqual(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [1, 0], targetCounts: [1, 0]), 0)
        XCTAssertNil(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [1, 0], targetCounts: [0, 1]))
        XCTAssertNil(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [1, 1], targetCounts: [1, 0]))
        XCTAssertNil(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [0, 0], targetCounts: nil))
        let window = CGRect(x: 0, y: 0, width: 951, height: 669)
        let appEnvelope = CGRect(x: 0, y: 0, width: 669, height: 951)
        let scroll = CGRect(x: 0, y: 0, width: 867, height: 386)
        let keyboard = CGRect(x: 75, y: 449, width: 801, height: 219)
        let geometry = try XCTUnwrap(FormScrollGeometry(application: window, scroll: scroll, keyboard: keyboard))
        XCTAssertNotEqual(window, appEnvelope)
        XCTAssertTrue(geometry.contains(CGRect(x: 170.67, y: 330, width: 526, height: 48)))
        XCTAssertFalse(geometry.contains(CGRect(x: 170.67, y: 362, width: 526, height: 48)))
        XCTAssertFalse(geometry.contains(CGRect(x: 350, y: 330, width: 526, height: 48)))
        let tallerScroll = CGRect(x: 0, y: 0, width: 867, height: 635)
        let keyboardClipped = try XCTUnwrap(FormScrollGeometry(application: window, scroll: tallerScroll, keyboard: keyboard))
        XCTAssertFalse(keyboardClipped.contains(CGRect(x: 170.67, y: 430, width: 526, height: 48)))
        let origin = CGPoint(x: 11, y: 23)
        let shifted = try XCTUnwrap(FormScrollGeometry(application: window.offsetBy(dx: origin.x, dy: origin.y),
                                                       scroll: scroll.offsetBy(dx: origin.x, dy: origin.y),
                                                       keyboard: keyboard.offsetBy(dx: origin.x, dy: origin.y)))
        let drag = try XCTUnwrap(shifted.gesture(target: CGRect(x: 170.67, y: 362, width: 526, height: 48).offsetBy(dx: origin.x, dy: origin.y), towardTop: false, horizontalPosition: 0.5))
        for point in [drag.start, drag.end] {
            XCTAssertTrue(shifted.viewport.contains(CGPoint(x: point.dx + origin.x, y: point.dy + origin.y)))
        }
    }

    private func verifyClassificationStartAction() {
        typealias Action = FormScrollGeometry.ClassificationStartAction
        let owner = CGRect(x: 0, y: 0, width: 678, height: 466)
        let footer = CGRect(x: 20, y: 400, width: 638, height: 50)
        func classify(_ label: String = Action.startLabel, button: Bool = true, enabled: Bool = true,
                      hittable: Bool = true, global: Int = 1, owned: Int = 1,
                      frame: CGRect = CGRect(x: 290, y: 400, width: 90, height: 44),
                      expanded: Bool = false) -> Action?
        {
            Action.resolve(label: label, isButton: button, enabled: enabled, hittable: hittable,
                           global: global, owned: owned, frame: frame, footer: footer, owner: owner,
                           inExpandedReader: expanded)
        }
        XCTAssertEqual(classify(), .start)
        XCTAssertEqual(classify(Action.expandLabel), .expand)
        XCTAssertEqual(classify(expanded: true), .start)
        XCTAssertNil(classify(Action.expandLabel, expanded: true))
        XCTAssertNil(classify("시작"))
        XCTAssertNil(classify("화면을 세로로 돌리거나 창을 키워 주세요"))
        XCTAssertNil(classify(button: false))
        XCTAssertNil(classify(enabled: false))
        XCTAssertNil(classify(hittable: false))
        XCTAssertNil(classify(global: 2))
        XCTAssertNil(classify(owned: 0))
        XCTAssertNil(classify(frame: CGRect(x: 290, y: 350, width: 90, height: 44)))
        XCTAssertNil(classify(frame: CGRect(x: 290, y: 400, width: 90, height: 43)))
    }

    @MainActor
    private func verifyClassificationStageOwner() {
        XCTAssertTrue(FormWindowOwnership.acceptsIdleClassificationRelease(global: 0, owned: 0, isButton: false, label: "", enabled: false))
        XCTAssertTrue(FormWindowOwnership.acceptsIdleClassificationRelease(global: 1, owned: 1, isButton: true, label: "Release synthetic idle", enabled: false))
        XCTAssertFalse(FormWindowOwnership.acceptsIdleClassificationRelease(global: 1, owned: 1, isButton: true, label: "Release synthetic idle", enabled: true))
        XCTAssertFalse(FormWindowOwnership.acceptsIdleClassificationRelease(global: 1, owned: 1, isButton: true, label: "Release synthetic model", enabled: false))
        XCTAssertFalse(FormWindowOwnership.acceptsIdleClassificationRelease(global: 1, owned: 0, isButton: true, label: "Release synthetic idle", enabled: false))
        XCTAssertFalse(FormWindowOwnership.acceptsIdleClassificationRelease(global: 2, owned: 1, isButton: true, label: "Release synthetic idle", enabled: false))
        XCTAssertFalse(FormWindowOwnership.acceptsIdleClassificationRelease(global: 1, owned: 1, isButton: false, label: "Release synthetic idle", enabled: false))
        let wide = CGRect(x: 0, y: 0, width: 678, height: 466)
        let frames = [wide, wide]
        XCTAssertTrue(FormScrollGeometry.acceptsOptionalStageMarker(global: 0, owned: 0))
        XCTAssertTrue(FormScrollGeometry.acceptsOptionalStageMarker(global: 1, owned: 1))
        XCTAssertFalse(FormScrollGeometry.acceptsOptionalStageMarker(global: 1, owned: 0))
        XCTAssertFalse(FormScrollGeometry.acceptsOptionalStageMarker(global: 0, owned: 1))
        XCTAssertFalse(FormScrollGeometry.acceptsOptionalStageMarker(global: 2, owned: 2))
        XCTAssertEqual(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: nil, counts: [[1, 0], [1, 0], [1, 0]]), 0)
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: nil, counts: [[1, 0], [1, 0], [0, 1]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: nil, counts: [[1, 0], [1, 1], [1, 0]]))
        XCTAssertEqual(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[1, 0], [1, 0], [1, 0]]), 0)
        XCTAssertEqual(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[0, 1], [0, 1]]), 1)
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[1, 1], [1, 0]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[1, 0], [1, 1]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[1, 0], [0, 1]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[1, 0], [2, 0]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[1, 0], [0, 0]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide, counts: [[1], [1]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: frames, observed: wide.offsetBy(dx: 2, dy: 0), counts: [[1, 0]]))
        XCTAssertNil(FormScrollGeometry.stageOwnerIndex(frames: [.null, wide], observed: wide, counts: [[1, 0]]))
    }

    private func verifyDisclosureReadingEdges() throws {
        let window = CGRect(x: 0, y: 0, width: 678, height: 466)
        let viewport = CGRect(x: 84, y: 93, width: 594, height: 339)
        let geometry = try XCTUnwrap(FormScrollGeometry(application: window, scroll: viewport, keyboard: nil))
        let atTop = CGRect(x: 94, y: 110, width: 574, height: 835)
        let atBottom = atTop.offsetBy(dx: 0, dy: -520)
        func observation(_ rect: CGRect, _ geometry: FormScrollGeometry) -> FormScrollGeometry.ReadingObservation {
            FormScrollGeometry.ReadingObservation(frame: rect, geometry: geometry)
        }
        let top = observation(atTop, geometry)
        XCTAssertFalse(geometry.contains(atTop))
        XCTAssertTrue(geometry.containsAction(CGRect(x: 94, y: 110, width: 44, height: 44)))
        XCTAssertFalse(geometry.containsAction(CGRect(x: 94, y: 110, width: 43, height: 44)))
        XCTAssertFalse(geometry.containsAction(CGRect(x: 94, y: 110, width: 44, height: 43)))
        XCTAssertFalse(geometry.containsAction(CGRect(x: 94, y: 400, width: 44, height: 44)))
        XCTAssertTrue(FormScrollGeometry.provesReadingEdgeReach(top: top, bottom: observation(atBottom, geometry)))
        XCTAssertFalse(FormScrollGeometry.provesReadingEdgeReach(top: top, bottom: top))
        XCTAssertFalse(FormScrollGeometry.provesReadingEdgeReach(top: top, bottom: observation(atBottom.offsetBy(dx: 20, dy: 0), geometry)))
        let clippedText = CGRect(x: 94, y: 110, width: 574, height: 100)
        XCTAssertFalse(FormScrollGeometry.provesReadingEdgeReach(top: top, bottom: observation(clippedText, geometry)))
        XCTAssertTrue(geometry.readingBounds(.infinite, bottom: false).isNull)
        XCTAssertTrue(geometry.readingBounds(.zero, bottom: true).isNull)
        XCTAssertFalse(geometry.contains(geometry.readingBounds(atTop, bottom: true)))
    }

    /// Representative synthetic frames reproduce the hosted editor/dock overlap; native hit testing remains separate.
    private func verifyActionDockOcclusion() throws {
        let app = CGRect(x: 0, y: 0, width: 402, height: 874)
        let scroll = CGRect(x: 0, y: 110, width: 402, height: 764)
        let editor = CGRect(x: 55, y: 776, width: 292, height: 70)
        let save = CGRect(x: 101, y: 792, width: 160, height: 48)
        let before = try XCTUnwrap(FormScrollGeometry(application: app, scroll: scroll, keyboard: nil))
        XCTAssertTrue(before.contains(editor))
        XCTAssertTrue(save.contains(CGPoint(x: editor.midX, y: editor.midY)))
        for origin in [CGPoint.zero, CGPoint(x: 11, y: 23)] {
            let movedEditor = editor.offsetBy(dx: origin.x, dy: origin.y)
            let safe = FormScrollGeometry.unobstructedScrollFrame(
                scroll.offsetBy(dx: origin.x, dy: origin.y), target: movedEditor,
                controls: [save.offsetBy(dx: origin.x, dy: origin.y)],
            )
            XCTAssertEqual(safe.maxY, 792 + origin.y)
            let geometry = try XCTUnwrap(FormScrollGeometry(application: app.offsetBy(dx: origin.x, dy: origin.y), scroll: safe, keyboard: nil))
            XCTAssertFalse(geometry.contains(movedEditor))
            let drag = try XCTUnwrap(geometry.gesture(target: movedEditor, towardTop: false, horizontalPosition: 0.5))
            XCTAssertLessThan(drag.end.dy, drag.start.dy)
            for point in [drag.start, drag.end] {
                XCTAssertTrue(geometry.viewport.contains(CGPoint(x: point.dx + origin.x, y: point.dy + origin.y)))
            }
            XCTAssertTrue(geometry.contains(movedEditor.offsetBy(dx: 0, dy: -70)))
        }
        // A button beside the target does not turn its transparent horizontal gap into an obstacle.
        let beside = CGRect(x: 350, y: 792, width: 44, height: 48)
        XCTAssertEqual(FormScrollGeometry.unobstructedScrollFrame(scroll, target: editor, controls: [beside]), scroll)
        XCTAssertEqual(FormScrollGeometry.unobstructedScrollFrame(scroll, target: editor, controls: []), scroll)
        let safe = FormScrollGeometry.unobstructedScrollFrame(scroll, target: editor, controls: [save])
        let keyboard = CGRect(x: 0, y: 590, width: 402, height: 284)
        let focused = try XCTUnwrap(FormScrollGeometry(application: app, scroll: safe, keyboard: keyboard))
        XCTAssertEqual(focused.viewport.maxY, 590)
        XCTAssertFalse(focused.contains(editor))
    }
}

/// Resolves the real native confirmation action independently of the staged journey.
extension AppointmentConsentUITests {
    enum ActivationError: Error {
        case unproven
    }

    @MainActor
    func startMeasuredClassification(_ app: XCUIApplication, anchor: ClassificationStageWindowAnchor?) throws {
        typealias Action = FormScrollGeometry.ClassificationStartAction
        let actionID = "medical-appointment-import"
        let closeID = "classification-close-reader"
        let footerID = "classification-stage-footer"
        let confirmationID = "medical-appointment-confirmation"
        let counterID = "calendar-classification-synthetic-provider-calls"
        let releaseID = "classification-release-response"
        let progressID = "medical-appointment-progress"
        let resultsID = "medical-appointment-results"

        func validate(inExpandedReader: Bool) throws -> (action: Action, element: XCUIElement) {
            // The Modal can project a separate AX window. Its close control, confirmation,
            // and footer must share the real action owner; the route root can remain outside it.
            let required = [confirmationID, footerID, actionID]
                + (inExpandedReader ? [closeID] : ["medical-appointment-fullscreen"])
            let owner = try FormWindowOwnership.resolveStage(app, observed: anchor?.frame, required: required)
            func scoped(_ id: String) -> XCUIElementQuery {
                owner.descendants(matching: .any).matching(identifier: id)
            }

            let counters = app.descendants(matching: .any).matching(identifier: counterID)
            let witness = inExpandedReader ? FormWindowOwnership.classificationReaderStartWitness(app, owner: owner) : nil
            let callsZero = witness?.callsZero ?? (counters.count == 1 && UITestConditions.text(counters.firstMatch) == "syntheticProviderCalls=0")
            let closeCount = app.descendants(matching: .any).matching(identifier: closeID).count
            let close = scoped(closeID).firstMatch
            let modal = close.exists && close.elementType == .button && close.label == Action.closeLabel
                && close.isEnabled && close.isHittable && owner.frame.contains(close.frame)
            let releaseIdle = witness?.releaseIdle ?? FormWindowOwnership.classificationReleaseIsIdle(app, releaseID: releaseID, counterID: counterID)
            let progress = node(app, progressID).exists
            let results = node(app, resultsID).exists
            guard closeCount == (inExpandedReader ? 1 : 0), modal == inExpandedReader,
                  callsZero, releaseIdle, !progress, !results
            else {
                XCTFail("Classification before Start: expanded=\(inExpandedReader), modal=\(modal), closeCount=\(closeCount), "
                    + "callsZero=\(callsZero), releaseIdle=\(releaseIdle), progress=\(progress), results=\(results)")
                throw ActivationError.unproven
            }

            let target = scoped(actionID).firstMatch
            let label = target.label
            let enabled = target.isEnabled
            let hittable = target.isHittable
            let button = target.elementType == .button
            let global = app.descendants(matching: .any).matching(identifier: actionID).count
            let owned = scoped(actionID).count
            guard let action = Action.resolve(
                label: label, isButton: button, enabled: enabled, hittable: hittable,
                global: global, owned: owned, frame: target.frame,
                footer: scoped(footerID).firstMatch.frame, owner: owner.frame,
                inExpandedReader: inExpandedReader,
            ) else {
                XCTFail("Classification invalid action: startLabel=\(label == Action.startLabel), expandLabel=\(label == Action.expandLabel), "
                    + "button=\(button), enabled=\(enabled), hittable=\(hittable), global=\(global), owned=\(owned)")
                throw ActivationError.unproven
            }
            return (action, target)
        }

        let first = try validate(inExpandedReader: false)
        XCTContext.runActivity(named: "Classification confirmation action: \(first.action.rawValue)") { _ in }
        first.element.tap()
        guard first.action == .expand else { return }

        let close = app.buttons.matching(identifier: closeID).firstMatch
        let start = app.buttons.matching(identifier: actionID).firstMatch
        let expandedReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            close.exists && close.label == Action.closeLabel && close.isHittable
                && start.exists && start.label == Action.startLabel && start.isHittable
                && self.node(app, FormWindowOwnership.classificationReaderStartWitnessID).exists
        }, object: nil)
        guard XCTWaiter.wait(for: [expandedReady], timeout: 8) == .completed else {
            XCTFail("Classification modal Start not reached: closeExists=\(close.exists), startExists=\(start.exists), startLabel=\(start.exists && start.label == Action.startLabel)")
            throw ActivationError.unproven
        }
        let expanded = try validate(inExpandedReader: true)
        // The native modal dismisses as a consequence of real Start; never tap Close or retry Start.
        expanded.element.tap()
    }
}
