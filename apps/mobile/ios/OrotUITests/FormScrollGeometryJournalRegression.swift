import XCTest

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
        let scrollView = view("scroll", CGRect(x: 0, y: 62, width: 402, height: 812))
        let context: [String: Any] = [
            "startedAtMs": 102.0, "endedAtMs": 103.0, "windowIdentity": window,
            "scrollCount": 1, "targetCount": 1, "windowBounds": frame(app), "windowFrameInScreen": frame(app),
            "clippingGeometryComplete": true, "modelClipIntersectionEmpty": true, "modelClipIntersection": NSNull(),
            "scroll": ["view": scrollView, "clipsToBounds": true, "isDragging": false, "isDecelerating": false, "isTracking": false],
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
    }
}
