import UIKit
import XCTest

/// Journal observations preserve original evidence while keeping per-field focus probes separate from gesture control.
@MainActor
enum SymptomJournalUITestObservations {
    @MainActor
    static func launchJournal(_ app: XCUIApplication) throws {
        // English device settings exercise the Korean-only copy through the real journal route.
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        // The passive marker is opted in for this scenario; diagnostic-only early-exit flags remain separate.
        app.launchArguments += ["-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let open = UITestConditions.element(app, "symptoms-open")
        XCTAssertTrue(UITestConditions.exists(open))
        FormUITestConditions.reveal(open, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(open.isHittable)
        open.tap()
        NavigationUITestConditions.route(app, markers: ["symptoms-title"])
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "symptoms-title")) && UITestConditions.element(app, "symptoms-title").label == "증상 일지" && !UITestConditions.element(app, "symptoms-back").exists)
    }

    /// Manual entry remains available for real keyboard recovery and focus evidence.
    static func openManualOnset(_ app: XCUIApplication) {
        let manual = UITestConditions.element(app, "symptom-onset-manual")
        FormUITestConditions.reveal(manual, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(manual.exists && manual.isHittable)
        manual.tap()
    }

    /// Checks the editor against the route viewport while preserving the screen's existing side padding.
    static func assertFullContentFormLane(_ app: XCUIApplication, testCase: XCTestCase) {
        let description = UITestConditions.element(app, "symptom-description")
        let scroll = UITestConditions.element(app, "symptoms-scroll")
        XCTAssertTrue(UITestConditions.exists(description))
        XCTAssertTrue(UITestConditions.exists(scroll))
        // Keep the existing marker's sample time; this read does not make its native frames atomic with the later AX query.
        let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "symptom-form-lane-width")
        let trace = snapshot?["symptomScrollTrace"] as? [String: Any]
        let accessory = trace?["descriptionAccessory"] as? [String: Any]
        let inputs = accessory?["inputs"] as? [[String: Any]]
        let geometry = inputs?.first?["geometry"] as? [String: Any]
        // Fabric exposes its backed UITextView to AX. Its 1-point border inset is not a narrower outer content lane.
        guard accessory?["truncated"] as? Bool == false, accessory?["inputCount"] as? Int == 1,
              inputs?.count == 1, geometry?["status"] as? String == "sampled",
              geometry?["outerComponentCount"] as? Int == 1,
              geometry?["ancestorTraversalComplete"] as? Bool == true,
              geometry?["accessibilityViewIsInput"] as? Bool == true,
              let outer = observedWindowFrame(geometry?["outer"]),
              let exposed = observedWindowFrame(geometry?["accessibilityView"]),
              let inset = geometry?["inputFrameInOuter"] as? [String: Double]
        else {
            XCTFail("The journal width check requires an unambiguous outer component and its public AX text view")
            return
        }
        let descriptionFrame = description.frame
        // The full-width editor contains one section: 20-point page padding, 16-point section padding and its 1-point border.
        let usableWidth = scroll.frame.width - 2 * (20 + 16 + 1)
        XCTAssertGreaterThan(usableWidth, 0)
        XCTAssertEqual(outer.width, usableWidth, accuracy: 1)
        XCTAssertEqual(inset["x"], 1)
        XCTAssertEqual(inset["width"], outer.width - 2)
        // Bind the later real XCUI query to the sampled public view; samples are not claimed to be atomic.
        XCTAssertEqual(descriptionFrame.width, exposed.width, accuracy: 1)
        XCTAssertEqual(descriptionFrame.minX, exposed.minX, accuracy: 1)
    }

    /// Missing windows and nonfinite geometry remain failed evidence rather than a guessed width.
    private static func observedWindowFrame(_ value: Any?) -> CGRect? {
        guard let view = value as? [String: Any], view["sameWindow"] as? Bool == true,
              let frame = view["windowFrame"] as? [String: Double],
              let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"],
              [x, y, width, height].allSatisfy(\.isFinite), width > 0, height > 0 else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    /// Bracket the existing post-refocus drag to distinguish focus acquisition from later loss, without another action or wait.
    static func onsetFocusObserver(_ app: XCUIApplication, input: XCUIElement, identifier: String, forwarding observer: ((String, CGRect?) -> Void)?) -> ((String, CGRect?) -> Void)? {
        guard identifier == "symptom-onset-date" else { return observer }
        var awaitingDrag = false
        return { phase, reservation in
            observer?(phase, reservation)
            if phase == "after-refocus-tap" {
                awaitingDrag = true
            } else {
                guard awaitingDrag, phase == "before-scroll-1" else { return }
                awaitingDrag = false
            }
            let boundIdentifier = input.identifier
            let matches = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND hasKeyboardFocus == true", input.identifier))
            // The assertion's broad query is reported verbatim; match roles keep a container result from being called field focus.
            let roles = matches.allElementsBoundByIndex.map { $0.elementType == .textField ? "textField" : "other(\($0.elementType.rawValue))" }
            let boundIsTextField = input.elementType == .textField
            let predicateMatched = matches.count > 0
            XCTContext.runActivity(named: "Onset focus bracket: phase=\(phase), requestedIdentifier=\(identifier), boundIdentifier=\(boundIdentifier), boundIsTextField=\(boundIsTextField), predicateMatched=\(predicateMatched), focusedMatchRoles=\(roles)") { _ in }
        }
    }

    /// Capture navigation once for both the unchanged clipping rule and its trace; separate AX reads could describe a different cutoff.
    static func navigationClipping(_ app: XCUIApplication, scroll: CGRect, target: CGRect, clip: (CGRect, CGRect?, XCUIApplication, [CGRect]?) -> CGRect) -> CGRect {
        let bar = UITestConditions.element(app, "navigation-action-bar-overlay")
        let buttons = bar.exists ? bar.descendants(matching: .button).allElementsBoundByIndex : []
        let observations = buttons.map { button -> (identifier: String, frame: CGRect?, hittable: Bool) in
            let exists = button.exists
            let hittable = exists && button.isHittable
            return (exists ? button.identifier : "absent", exists ? button.frame : nil, hittable)
        }
        let frames = observations.compactMap { $0.hittable ? $0.frame : nil }
        let usable = clip(scroll, target, app, frames)
        let cutoffY = frames.filter { $0.intersects(scroll) && $0.maxX > target.minX && $0.minX < target.maxX && $0.minY < scroll.maxY }
            .map(\.minY).min()
        let details = observations.map { observation in
            let overlaps = observation.frame.map { !($0.maxX <= target.minX || $0.minX >= target.maxX) } ?? false
            let intersects = observation.frame?.intersects(scroll) == true
            let clips = observation.hittable && overlaps && intersects
            let setsCutoff = clips && observation.frame?.minY == cutoffY
            return "identifier=\(observation.identifier), frame=\(String(describing: observation.frame)), hittable=\(observation.hittable), horizontalOverlap=\(overlaps), intersectsScroll=\(intersects), clips=\(clips), setsFinalCutoff=\(setsCutoff)"
        }.joined(separator: "; ")
        XCTContext.runActivity(named: "Refocused navigation clipping: scroll=\(scroll), target=\(target), usable=\(usable), cutoffY=\(usable.maxY); \(details)") { _ in }
        return usable
    }

    /// Observe focus loss at the unchanged edit cursor tap without adding a pass condition.
    @MainActor
    static func cursorTap(_ app: XCUIApplication, input: XCUIElement, phase: String) {
        func geometry(_ element: XCUIElement) -> String {
            let exists = element.exists
            return "exists=\(exists), frame=\(exists ? String(describing: element.frame) : "absent"), hittable=\(exists && element.isHittable)"
        }
        let keyboard = app.keyboards.firstMatch
        let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true"))
            .allElementsBoundByIndex.map(\.identifier)
        let observations = [
            "input: \(geometry(input))",
            "keyboard: \(geometry(keyboard))",
            "back: \(geometry(app.buttons["navigation-back"]))",
            "home: \(geometry(app.buttons["navigation-home"]))",
            "journalVisible=\(UITestConditions.element(app, "symptoms-title").exists)",
            "alerts=\(app.alerts.allElementsBoundByIndex.map(\.label))",
            "focusedIdentifiers=\(focused)",
        ].joined(separator: "; ")
        XCTContext.runActivity(named: "Journal cursor tap \(phase): \(observations)") { activity in
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "journal-cursor-tap-\(phase)"
            screenshot.lifetime = .keepAlways
            activity.add(screenshot)
        }
    }

    /// AX frames use screen points; start/end are app-origin offsets. Sequential reads never identify original touch recipients.
    @MainActor
    static func onsetReveal(_ app: XCUIApplication, application: CGRect, viewport: CGRect, target: CGRect?, controls: [CGRect], start: CGVector, end: CGVector) {
        let element = app.textViews["symptom-description"]
        let editor = element.exists ? element.frame : nil
        print("Onset reveal: application=\(application), viewport=\(viewport), editor=\(String(describing: editor)), target=\(String(describing: target)), controls=\(controls), start=\(start), end=\(end)")
        guard let editor, let target, [editor, target].allSatisfy({ !$0.isNull && !$0.isInfinite && $0.width > 0 && $0.height > 0 }) else {
            print("Onset reveal: no clear candidate; editor or target frame unavailable")
            return
        }
        FormScrollGeometryJournalPlan.reportSideSegments(application: application, viewport: viewport, editor: editor, blockers: [editor, target] + controls, start: start, end: end)
    }

    /// A multiline editor can consume an overlapping form drag. Prefer the clear right gutter, then the left, without changing vertical travel.
    static func gutterGesture(_ app: XCUIApplication, application: CGRect, viewport: CGRect, keyboard: CGRect?, target: CGRect?, targetIdentifier: () -> String, controls: [CGRect], latestControls: () -> [CGRect], proposed: () -> (start: CGVector, end: CGVector)?, evaluationStartedAtMs: Double, maximumScrollFraction: CGFloat) -> FormScrollGeometryJournalPlan.Plan? {
        let element = app.textViews["symptom-description"]
        // Without a text editor this overlap boundary is absent; other journal scrolling keeps its existing behavior.
        guard element.exists else {
            guard let original = proposed() else { XCTFail("The form gesture has invalid coordinates"); return nil }
            return .init(start: original.start, end: original.end, target: target, viewport: viewport)
        }
        let editorReadStartedAtMs = Date().timeIntervalSince1970 * 1000
        var editor = element.frame
        let editorReadEndedAtMs = Date().timeIntervalSince1970 * 1000
        if !FormScrollGeometry.valid(editor) {
            // Read once for both validation and diagnostics. Rejected samples never trigger another query or gesture.
            let identifier = targetIdentifier()
            let nativeTarget = ["symptom-status-active", "symptom-form-error"].contains(identifier)
            var freshPlan: FormScrollGeometryJournalPlan.Plan?
            let original = nativeTarget ? nil : proposed()
            XCTContext.runActivity(named: "Journal invalid editor gutter observation") { activity in
                let marker = UITestConditions.element(app, "navigation-test-observation")
                let markerReadStartedAtMs = Date().timeIntervalSince1970 * 1000
                let payload = marker.exists ? UITestConditions.text(marker) : "{\"status\":\"unavailable\"}"
                let markerReadEndedAtMs = Date().timeIntervalSince1970 * 1000
                let snapshot = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any]
                let nativeEditor = target.flatMap { target in original.flatMap { original in
                    FormScrollGeometry.clippedJournalEditor(snapshot, application: application, viewport: viewport, target: target,
                                                            identifier: identifier, evaluationStartedAtMs: evaluationStartedAtMs,
                                                            readEndedAtMs: markerReadEndedAtMs, start: original.start, end: original.end)
                } }
                let keyboardReadStartedAtMs = Date().timeIntervalSince1970 * 1000
                let keyboardElement = app.keyboards.firstMatch
                let keyboardExists = keyboardElement.exists
                let measuredKeyboard = keyboardExists ? keyboardElement.frame : nil
                let keyboardFrame = measuredKeyboard.map { String(describing: $0) } ?? "absent"
                let keyboardReadEndedAtMs = Date().timeIntervalSince1970 * 1000
                let plannerInvoked = nativeTarget
                let laterControls = plannerInvoked ? latestControls() : []
                if plannerInvoked {
                    freshPlan = FormScrollGeometryJournalPlan.make(snapshot: snapshot, application: application, usableViewport: viewport, keyboard: measuredKeyboard, earlierKeyboard: keyboard, controls: controls + laterControls, identifier: identifier, evaluationStartedAtMs: evaluationStartedAtMs, readEndedAtMs: markerReadEndedAtMs, maximumScrollFraction: maximumScrollFraction)
                }
                let observation: [String: Any] = [
                    "editorReadStartedAtMs": editorReadStartedAtMs, "editorReadEndedAtMs": editorReadEndedAtMs,
                    "markerReadStartedAtMs": markerReadStartedAtMs, "markerReadEndedAtMs": markerReadEndedAtMs,
                    "editorAXFrame": String(describing: editor), "targetAXFrame": String(describing: target),
                    "applicationAXFrame": String(describing: application), "viewportAXFrame": String(describing: viewport),
                    "evaluationStartedAtMs": evaluationStartedAtMs, "targetIdentifier": identifier,
                    "nativeEditorAccepted": nativeEditor != nil,
                    "resolvedEditorFrame": nativeEditor.map { String(describing: $0) } ?? "unavailable",
                    "navigationAXFrames": controls.map { String(describing: $0) },
                    "laterNavigationAXFrames": laterControls.map { String(describing: $0) },
                    "preGutterGestureInScreenPoints": original.map { ["start": String(describing: CGPoint(x: application.minX + $0.start.dx, y: application.minY + $0.start.dy)), "end": String(describing: CGPoint(x: application.minX + $0.end.dx, y: application.minY + $0.end.dy))] } as Any? ?? NSNull(),
                    "keyboardExists": keyboardExists, "keyboardAXFrame": keyboardFrame,
                    "keyboardReadStartedAtMs": keyboardReadStartedAtMs, "keyboardReadEndedAtMs": keyboardReadEndedAtMs,
                    "evaluationKeyboardAXFrame": keyboard.map { String(describing: $0) } ?? "absent", "keyboardFramesEqual": keyboard == measuredKeyboard,
                    "plannerInvoked": plannerInvoked, "plannerReturned": freshPlan != nil, "maximumScrollFraction": maximumScrollFraction,
                    "freshGesture": freshPlan.map { ["start": String(describing: $0.start), "end": String(describing: $0.end)] } as Any? ?? NSNull(),
                    // The native main-actor sample has its own timestamps; this later AX read is not atomic with it.
                    "nativeMarker": snapshot as Any? ?? payload,
                ]
                let data = (try? JSONSerialization.data(withJSONObject: observation, options: [.sortedKeys])) ?? Data("{\"status\":\"serialization-unavailable\"}".utf8)
                let record = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                record.name = "journal-invalid-editor-gutter"
                record.lifetime = .keepAlways
                activity.add(record)
                editor = nativeEditor ?? editor
            }
            if nativeTarget {
                guard let freshPlan else { XCTFail("The journal target requires a coherent native gesture plan"); return nil }
                return freshPlan
            }
        }
        guard let original = proposed() else { XCTFail("The form gesture has invalid coordinates"); return nil }
        let start = original.start, end = original.end
        guard let target, let segment = sideSegments(application: application, viewport: viewport, editor: editor, blockers: [editor, target] + controls, start: start, end: end).last else {
            XCTFail("The journal form requires a clear side gutter inside the usable viewport: editor=\(editor), target=\(String(describing: target)), viewport=\(viewport), controls=\(controls)")
            return nil
        }
        print("Journal gutter: editor=\(editor), target=\(target), viewport=\(viewport), side=\(segment.side), start=\(segment.from), end=\(segment.to)")
        return .init(start: CGVector(dx: segment.from.x - application.minX, dy: start.dy), end: CGVector(dx: segment.to.x - application.minX, dy: end.dy), target: target, viewport: viewport)
    }

    /// Validate the entire vertical segment, including endpoints and blocker edges, from the same captured frames.
    private static func sideSegments(application: CGRect, viewport: CGRect, editor: CGRect, blockers: [CGRect], start: CGVector, end: CGVector) -> [(side: String, from: CGPoint, to: CGPoint)] {
        FormScrollGeometry.journalSideSegments(application: application, viewport: viewport, editor: editor, blockers: blockers, start: start, end: end)
    }
}
