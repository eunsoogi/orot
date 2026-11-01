import XCTest

/// Runs the journal geometry contract independently of the system share-sheet journey.
final class FormScrollGeometryJournalRegression: XCTestCase {
    @MainActor
    func testFreshJournalGestureBoundaries() throws {
        try FormScrollGeometryRegression.verifyClippedJournalEditor()
        SymptomDateSelectionUITestObservation.verifyCorrelation()
    }
}

/// Exercise the existing geometry regression entry point with the observed offscreen-editor shape.
extension FormScrollGeometryRegression {
    static func verifyClippedJournalEditor() throws {
        let app = CGRect(x: 0, y: 0, width: 402, height: 874)
        let viewport = CGRect(x: 0, y: 62, width: 402, height: 730)
        let target = CGRect(x: 207, y: -61, width: 160, height: 80)
        let start = CGVector(dx: 201, dy: 244.5)
        let end = CGVector(dx: 201, dy: 375)
        let editor = CGRect(x: 35, y: -640, width: 332, height: 438)
        let outer = editor.insetBy(dx: -1, dy: -1)
        let window = "window"
        func frame(_ rect: CGRect) -> [String: Double] {
            ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height)]
        }
        func view(_ id: String, _ rect: CGRect) -> [String: Any] {
            ["identity": id, "sameWindow": true, "windowFrame": frame(rect)]
        }
        func visibility(_ id: String) -> [String: Any] {
            ["identity": id, "windowIdentity": window, "hasWindow": true, "windowHidden": false,
             "hidden": false, "ancestorHidden": false, "visibilityTraversalComplete": true, "alpha": 1.0]
        }
        let scrollView = view("scroll", CGRect(x: 0, y: 62, width: 402, height: 812)).merging(["bounds": frame(CGRect(x: 0, y: 0, width: 402, height: 812))]) { _, new in new }
        let context: [String: Any] = [
            "startedAtMs": 102.0, "endedAtMs": 103.0, "windowIdentity": window,
            "scrollCount": 1, "targetCount": 1, "windowBounds": frame(app), "windowFrameInScreen": frame(app),
            "clippingGeometryComplete": true, "modelClipIntersectionEmpty": true, "modelClipIntersection": NSNull(),
            "scroll": ["view": scrollView, "clipsToBounds": true, "isDragging": false, "isDecelerating": false, "isTracking": false, "contentOffset": ["x": 0.0, "y": 0.0], "contentSize": ["width": 402.0, "height": 1200.0]],
            "target": ["identifier": "observed-target", "view": view("target", target), "visibility": visibility("target"),
                       "sameSelectedScroll": true, "nearestScrollIdentity": "scroll"],
            "clippingAncestors": [scrollView.merging(["hasLayerMask": false]) { _, new in new }],
        ]
        let geometry: [String: Any] = [
            "status": "sampled", "atMs": 101.0, "outerComponentCount": 1, "ancestorTraversalComplete": true,
            "accessibilityViewIsInput": true, "windowIdentity": window, "interaction": context,
            "input": view("editor", editor), "accessibilityView": view("editor", editor), "outer": view("outer", outer),
            "accessibilityViewVisibility": visibility("editor"), "outerVisibility": visibility("outer"),
        ]
        func snapshot(_ geometry: [String: Any], count: Int = 1) -> [String: Any] {
            ["atMs": 104.0, "symptomScrollTrace": ["descriptionAccessory": ["truncated": false, "inputCount": count,
                                                                            "inputs": [["geometry": geometry]]]]]
        }
        func resolve(_ value: [String: Any]?, identifier: String = "observed-target", lower: Double = 100,
                     application: CGRect? = nil, visible: CGRect? = nil) -> CGRect?
        {
            FormScrollGeometry.clippedJournalEditor(value, application: application ?? app, viewport: visible ?? viewport,
                                                    target: target, identifier: identifier, evaluationStartedAtMs: lower,
                                                    readEndedAtMs: 105, start: start, end: end)
        }
        let resolved = try XCTUnwrap(resolve(snapshot(geometry)))
        XCTAssertEqual(resolved, editor)
        // A native frame only supplies geometry; the original blocker and full-segment checks still select the touch.
        let selected = try XCTUnwrap(FormScrollGeometry.journalSideSegments(application: app, viewport: viewport, editor: resolved,
                                                                            blockers: [resolved, target], start: start, end: end).last)
        XCTAssertEqual(selected.side, "right")
        XCTAssertEqual(selected.from.x, 384.5)
        XCTAssertTrue(viewport.contains(selected.from) && viewport.contains(selected.to))
        XCTAssertTrue(FormScrollGeometry.journalSideSegments(application: app, viewport: viewport, editor: resolved,
                                                             blockers: [resolved, target, viewport], start: start, end: end).isEmpty)
        XCTAssertNil(resolve(nil))
        XCTAssertNil(resolve(snapshot(geometry), identifier: "another-target"))
        XCTAssertNil(resolve(snapshot(geometry), identifier: ""))
        XCTAssertNil(resolve(snapshot(geometry), lower: 102))
        XCTAssertNil(resolve(snapshot(geometry, count: 2)))
        XCTAssertNil(resolve(snapshot(geometry), application: app.offsetBy(dx: 5, dy: 0)))
        XCTAssertNil(resolve(snapshot(geometry), visible: app))
        for (key, value) in [("targetCount", 2 as Any), ("scrollCount", 2 as Any), ("windowIdentity", "other" as Any),
                             ("clippingGeometryComplete", false as Any), ("modelClipIntersectionEmpty", false as Any),
                             ("endedAtMs", 106.0 as Any)]
        {
            var changed = geometry
            changed["interaction"] = context.merging([key: value]) { _, new in new }
            XCTAssertNil(resolve(snapshot(changed)), key)
        }
        var visible = geometry
        let onscreen = editor.offsetBy(dx: 0, dy: 800)
        visible["input"] = view("editor", onscreen)
        visible["accessibilityView"] = view("editor", onscreen)
        visible["outer"] = view("outer", onscreen.insetBy(dx: -1, dy: -1))
        XCTAssertNil(resolve(snapshot(visible)))
        for key in ["accessibilityViewIsInput", "ancestorTraversalComplete"] {
            var changed = geometry
            changed[key] = false
            XCTAssertNil(resolve(snapshot(changed)), key)
        }
        var mismatched = context
        var otherTarget = try XCTUnwrap(context["target"] as? [String: Any])
        otherTarget["view"] = view("target", target.offsetBy(dx: 1, dy: 0))
        mismatched["target"] = otherTarget
        var changed = geometry
        changed["interaction"] = mismatched
        XCTAssertNil(resolve(snapshot(changed)))
        // A status plan uses the native target rather than any earlier AX direction.
        let groups: [[String: Any]] = [
            ["role": "symptom-description", "count": 1, "truncated": false, "candidates": [["id": "editor", "windowID": window, "nearestScrollID": "scroll", "sameSelectedScroll": true, "hidden": false, "ancestorHidden": false, "alpha": 1.0, "clippingComplete": true, "clippedFrameEmpty": true, "frame": frame(editor)]]],
            ["role": "symptom-status-active", "count": 1, "truncated": false, "candidates": [["id": "target", "windowID": window, "nearestScrollID": "scroll", "sameSelectedScroll": true, "hidden": false, "ancestorHidden": false, "alpha": 1.0, "clippingComplete": true, "frame": frame(target)]]],
        ] + ["symptom-save", "symptom-form-cancel", "navigation-page-action-overflow", "navigation-back"].map { ["role": $0, "count": 0, "truncated": false, "candidates": []] }
            + [["role": "navigation-home", "count": 1, "truncated": false, "candidates": [["windowID": window, "hidden": false, "ancestorHidden": false, "clippingComplete": true, "alpha": 1.0, "frame": frame(CGRect(x: 314, y: 792, width: 64, height: 48))]]]]
        let declared: [String: Any] = ["startedAtMs": 103.0, "endedAtMs": 103.5, "windowID": window, "truncated": false,
                                       "selectionComplete": true, "selectedScrollCount": 1,
                                       "dock": ["complete": true, "windowID": window, "controls": [["id": "home", "frame": frame(CGRect(x: 314, y: 792, width: 64, height: 48))]]],
                                       "scroll": ["id": "scroll", "tracking": false, "dragging": false, "decelerating": false, "offset": ["x": 0.0, "y": 0.0], "size": ["width": 402.0, "height": 1200.0], "bounds": frame(CGRect(x: 0, y: 0, width: 402, height: 812))], "controls": groups]
        var statusGeometry = geometry
        statusGeometry["declaredControls"] = declared
        let keyboardEvent: [String: Any] = ["event": "symptom-native-keyboard-frame", "traceID": "trace", "scrollViewID": "scroll", "sequence": 1, "phase": "did-change-frame", "receivedAtMs": 102.0, "endFrameInScreen": frame(CGRect(x: 0, y: 874, width: 402, height: 270))]
        func statusSnapshot(_ value: [String: Any], event: [String: Any], initialAbsence: Bool) -> [String: Any] {
            let events: [[String: Any]] = initialAbsence ? [["event": "symptom-native-scroll-trace", "phase": "attached", "traceID": "trace", "scrollViewID": "scroll", "sequence": 1, "receivedAtMs": 100.5]] : [event]
            return ["atMs": 104.0, "symptomScrollTrace": ["traceID": "trace", "events": events, "recordedCount": events.count, "droppedCount": 0, "selection": ["attached": true, "reason": "attached", "scrollViewID": "scroll"], "descriptionAccessory": ["truncated": false, "inputCount": 1, "inputs": [["geometry": value]]]]]
        }
        func plan(_ value: [String: Any], blocks: [CGRect] = [CGRect(x: 314, y: 792, width: 64, height: 48)], keyboard: CGRect? = nil, earlierKeyboard: CGRect? = nil, visible: CGRect? = nil, event: [String: Any]? = nil, fraction: CGFloat = 0.45, identifier: String = "symptom-status-active", initialAbsence: Bool = false) -> FormScrollGeometryJournalPlan.Plan? {
            FormScrollGeometryJournalPlan.make(snapshot: statusSnapshot(value, event: event ?? keyboardEvent, initialAbsence: initialAbsence), application: app, usableViewport: visible ?? viewport, keyboard: keyboard, earlierKeyboard: earlierKeyboard, controls: blocks, identifier: identifier, evaluationStartedAtMs: 100, readEndedAtMs: 105, maximumScrollFraction: fraction)
        }
        let upward = try XCTUnwrap(plan(statusGeometry))
        XCTAssertGreaterThan(upward.end.dy, upward.start.dy)
        XCTAssertLessThanOrEqual(abs(upward.end.dy - upward.start.dy), viewport.height * 0.45)
        XCTAssertNil(plan(statusGeometry, blocks: [viewport]))
        XCTAssertNil(plan(statusGeometry, keyboard: CGRect(x: 0, y: 590, width: 402, height: 226)))
        var selfGeometry = statusGeometry
        selfGeometry["declaredControls"] = declared.merging(["focusCount": 0, "otherWindowFocusCount": 0, "focusRole": "none"]) { _, new in new }
        let selfPlan = try XCTUnwrap(plan(selfGeometry, identifier: "symptom-description", initialAbsence: true))
        XCTAssertGreaterThan(selfPlan.end.dy, selfPlan.start.dy)
        XCTAssertNil(plan(selfGeometry, blocks: [viewport], identifier: "symptom-description", initialAbsence: true))
        XCTAssertNil(plan(selfGeometry, keyboard: CGRect(x: 0, y: 590, width: 402, height: 226), identifier: "symptom-description", initialAbsence: true))
        var wrongSelf = selfGeometry
        wrongSelf["input"] = view("other", editor)
        XCTAssertNil(plan(wrongSelf, identifier: "symptom-description", initialAbsence: true))
        for change: [String: Any] in [["focusCount": 1], ["selectionComplete": false], ["truncated": true], ["dock": ["complete": false]]] {
            var rejected = selfGeometry
            rejected["declaredControls"] = (selfGeometry["declaredControls"] as? [String: Any] ?? [:]).merging(change) { _, new in new }
            XCTAssertNil(plan(rejected, identifier: "symptom-description", initialAbsence: true))
        }
        let partialKeyboard = keyboardEvent.merging(["endFrameInScreen": frame(CGRect(x: 0, y: 546, width: 402, height: 328))]) { _, new in new }
        let axKeyboard = CGRect(x: 0, y: 590, width: 402, height: 226)
        let nativeKeyboard = CGRect(x: 0, y: 546, width: 402, height: 328)
        let constrained = try XCTUnwrap(plan(statusGeometry, keyboard: axKeyboard, visible: CGRect(x: 0, y: 62, width: 402, height: 388), event: partialKeyboard))
        var laterDock = statusGeometry
        let save = CGRect(x: 120, y: 450, width: 162, height: 48)
        laterDock["declaredControls"] = declared.merging(["dock": ["complete": true, "windowID": window, "controls": [["id": "home", "frame": frame(CGRect(x: 314, y: 792, width: 64, height: 48))], ["id": "save", "frame": frame(save)]]]]) { _, new in new }
        let mixed = try XCTUnwrap(plan(laterDock, keyboard: axKeyboard, earlierKeyboard: CGRect(x: 0, y: 918, width: 402, height: 226), visible: CGRect(x: 0, y: 62, width: 402, height: 436), event: partialKeyboard))
        XCTAssertLessThanOrEqual(mixed.viewport.maxY, 498)
        let constrainedStart = CGPoint(x: constrained.start.dx, y: constrained.start.dy)
        let constrainedEnd = CGPoint(x: constrained.end.dx, y: constrained.end.dy)
        XCTAssertTrue(constrained.viewport.contains(constrainedStart) && constrained.viewport.contains(constrainedEnd))
        XCTAssertFalse(constrained.viewport.intersects(axKeyboard) || constrained.viewport.intersects(nativeKeyboard))
        XCTAssertFalse(axKeyboard.contains(constrainedStart) || axKeyboard.contains(constrainedEnd))
        XCTAssertFalse(nativeKeyboard.contains(constrainedStart) || nativeKeyboard.contains(constrainedEnd))
        XCTAssertNil(plan(statusGeometry, keyboard: CGRect(x: 0, y: 500, width: 402, height: 316), visible: CGRect(x: 0, y: 62, width: 402, height: 388), event: partialKeyboard))
        let matchingKeyboard = keyboardEvent.merging(["endFrameInScreen": frame(CGRect(x: 0, y: 590, width: 402, height: 284))]) { _, new in new }
        XCTAssertNotNil(plan(statusGeometry, keyboard: CGRect(x: 0, y: 590, width: 402, height: 284), visible: CGRect(x: 0, y: 62, width: 402, height: 388), event: matchingKeyboard))
        let overlappingKeyboard = keyboardEvent.merging(["endFrameInScreen": frame(CGRect(x: 0, y: 400, width: 402, height: 474))]) { _, new in new }
        let smaller = try XCTUnwrap(plan(statusGeometry, keyboard: CGRect(x: 0, y: 400, width: 402, height: 474), visible: CGRect(x: 0, y: 62, width: 402, height: 388), event: overlappingKeyboard))
        XCTAssertLessThanOrEqual(smaller.viewport.maxY, 400)
        for altered: [String: Any] in [["traceID": "other"], ["scrollViewID": "other"], ["phase": "will-change-frame"], ["receivedAtMs": 104.0]] {
            XCTAssertNil(plan(statusGeometry, event: keyboardEvent.merging(altered) { _, new in new }))
        }
        var blockedGroups = groups
        let leftBlock = CGRect(x: 10, y: 300, width: 15, height: 10)
        let rightBlock = CGRect(x: 380, y: 300, width: 15, height: 10)
        blockedGroups[blockedGroups.count - 2]["count"] = 1
        blockedGroups[blockedGroups.count - 2]["candidates"] = [["windowID": window, "hidden": false, "ancestorHidden": false, "clippingComplete": true, "alpha": 1.0, "frame": frame(leftBlock)]]
        blockedGroups[blockedGroups.count - 1]["candidates"] = [["windowID": window, "hidden": false, "ancestorHidden": false, "clippingComplete": true, "alpha": 1.0, "frame": frame(rightBlock)]]
        var blockedGeometry = statusGeometry
        blockedGeometry["declaredControls"] = declared.merging(["controls": blockedGroups, "dock": ["complete": true, "windowID": window, "controls": [["id": "left", "frame": frame(leftBlock)], ["id": "right", "frame": frame(rightBlock)]]]]) { _, new in new }
        XCTAssertNil(plan(blockedGeometry, blocks: [leftBlock, rightBlock]))
        for dock: [String: Any] in [["complete": false, "windowID": window, "controls": []],
                                    ["complete": true, "windowID": "other", "controls": [["id": "home", "frame": frame(rightBlock)]]],
                                    ["complete": true, "windowID": window, "controls": [["id": "same", "frame": frame(leftBlock)], ["id": "same", "frame": frame(rightBlock)]]]]
        {
            var rejected = statusGeometry
            rejected["declaredControls"] = declared.merging(["dock": dock]) { _, new in new }
            XCTAssertNil(plan(rejected))
        }
        var belowGroups = groups
        var below = try XCTUnwrap((belowGroups[1]["candidates"] as? [[String: Any]])?.first)
        below["frame"] = frame(CGRect(x: 207, y: 850, width: 160, height: 80))
        belowGroups[1]["candidates"] = [below]
        var belowGeometry = statusGeometry
        belowGeometry["declaredControls"] = declared.merging(["controls": belowGroups]) { _, new in new }
        let downward = try XCTUnwrap(plan(belowGeometry))
        XCTAssertLessThan(downward.end.dy, downward.start.dy)
        // A validation message uses its own sampled view and never the earlier AX target or focused time field.
        var errorGroups = belowGroups
        errorGroups[1]["role"] = "symptom-form-error"
        var errorGeometry = statusGeometry
        errorGeometry["declaredControls"] = declared.merging(["controls": errorGroups]) { _, new in new }
        let errorPlan = try XCTUnwrap(plan(errorGeometry, identifier: "symptom-form-error"))
        XCTAssertLessThan(errorPlan.end.dy, errorPlan.start.dy)
        XCTAssertNil(plan(errorGeometry, identifier: "symptom-status-active"))
        for field in ["windowID", "nearestScrollID"] {
            var badGroups = errorGroups
            var badTarget = try XCTUnwrap((badGroups[1]["candidates"] as? [[String: Any]])?.first)
            badTarget[field] = "other"
            badGroups[1]["candidates"] = [badTarget]
            var rejected = errorGeometry
            rejected["declaredControls"] = declared.merging(["controls": badGroups]) { _, new in new }
            XCTAssertNil(plan(rejected, identifier: "symptom-form-error"))
        }
        errorGroups[1]["count"] = 2
        errorGeometry["declaredControls"] = declared.merging(["controls": errorGroups]) { _, new in new }
        XCTAssertNil(plan(errorGeometry, identifier: "symptom-form-error"))
        for changed: [String: Any] in [["selectionComplete": false], ["truncated": true], ["windowID": "other"]] {
            var rejected = statusGeometry
            rejected["declaredControls"] = declared.merging(changed) { _, new in new }
            XCTAssertNil(plan(rejected))
        }
        var duplicate = statusGeometry
        var duplicateGroups = groups
        duplicateGroups[1]["count"] = 2
        duplicate["declaredControls"] = declared.merging(["controls": duplicateGroups]) { _, new in new }
        XCTAssertNil(plan(duplicate))
        var clippedGroups = groups
        var clipped = try XCTUnwrap((clippedGroups[1]["candidates"] as? [[String: Any]])?.first)
        clipped["clippingComplete"] = false
        clippedGroups[1]["candidates"] = [clipped]
        var incomplete = statusGeometry
        incomplete["declaredControls"] = declared.merging(["controls": clippedGroups]) { _, new in new }
        XCTAssertNil(plan(incomplete))
        var changedInput = statusGeometry
        changedInput["input"] = view("editor", editor.offsetBy(dx: 1, dy: 0))
        XCTAssertNil(plan(changedInput))
        for changedScroll: [String: Any] in [["offset": ["x": 0.0, "y": 1.0]], ["size": ["width": 402.0, "height": 1201.0]], ["bounds": frame(CGRect(x: 0, y: 0, width: 402, height: 811))], ["tracking": true]] {
            let originalScroll = try XCTUnwrap(declared["scroll"] as? [String: Any])
            var rejected = statusGeometry
            rejected["declaredControls"] = declared.merging(["scroll": originalScroll.merging(changedScroll) { _, new in new }]) { _, new in new }
            XCTAssertNil(plan(rejected))
        }
    }
}
