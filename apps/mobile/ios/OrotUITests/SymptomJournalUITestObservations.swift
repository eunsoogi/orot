import UIKit
import XCTest

/// Journal observations preserve original evidence while keeping per-field focus probes separate from gesture control.
@MainActor
enum SymptomJournalUITestObservations {
    /// Checks the editor against the route viewport while preserving the screen's existing side padding.
    static func assertFullContentFormLane(_ app: XCUIApplication) {
        let description = UITestConditions.element(app, "symptom-description")
        let scroll = UITestConditions.element(app, "symptoms-scroll")
        XCTAssertTrue(UITestConditions.exists(description))
        XCTAssertTrue(UITestConditions.exists(scroll))
        let descriptionWidth = description.frame.width
        // The description spans the route width after 20-point screen and 14-point form padding.
        let usableWidth = scroll.frame.width - 68
        XCTAssertGreaterThan(usableWidth, 0)
        XCTAssertEqual(descriptionWidth, usableWidth, accuracy: 1)
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

    /// Diagnose focus loss at the unchanged edit cursor tap; geometry and screenshots are observations, not new pass conditions.
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
        reportSideSegments(application: application, viewport: viewport, editor: editor, blockers: [editor, target] + controls, start: start, end: end)
    }

    /// Candidate segments use captured screen points; reporting neither chooses nor executes a replacement gesture.
    private static func reportSideSegments(application: CGRect, viewport: CGRect, editor: CGRect, blockers: [CGRect], start: CGVector, end: CGVector) {
        let candidates = sideSegments(application: application, viewport: viewport, editor: editor, blockers: blockers, start: start, end: end)
            .map { "\($0.side): \($0.from) -> \($0.to)" }
        print("Side gutter segments: \(candidates.isEmpty ? "no clear candidate" : candidates.joined(separator: "; "))")
    }

    /// A multiline editor can consume an overlapping form drag. Prefer the clear right gutter, then the left, without changing vertical travel.
    static func gutterGesture(_ app: XCUIApplication, application: CGRect, viewport: CGRect, target: CGRect?, controls: [CGRect], start: CGVector, end: CGVector) -> (start: CGVector, end: CGVector)? {
        let element = app.textViews["symptom-description"]
        // Without a text editor this overlap boundary is absent; other journal scrolling keeps its existing behavior.
        guard element.exists else { return (start, end) }
        let editor = element.frame
        guard let target, let segment = sideSegments(application: application, viewport: viewport, editor: editor, blockers: [editor, target] + controls, start: start, end: end).last else {
            XCTFail("The journal form requires a clear side gutter inside the usable viewport: editor=\(editor), target=\(String(describing: target)), viewport=\(viewport), controls=\(controls)")
            return nil
        }
        print("Journal gutter: editor=\(editor), target=\(target), viewport=\(viewport), side=\(segment.side), start=\(segment.from), end=\(segment.to)")
        return (CGVector(dx: segment.from.x - application.minX, dy: start.dy), CGVector(dx: segment.to.x - application.minX, dy: end.dy))
    }

    /// Validate the entire vertical segment, including endpoints and blocker edges, from the same captured frames.
    private static func sideSegments(application: CGRect, viewport: CGRect, editor: CGRect, blockers: [CGRect], start: CGVector, end: CGVector) -> [(side: String, from: CGPoint, to: CGPoint)] {
        [("left", viewport.minX, min(viewport.maxX, editor.minX)), ("right", max(viewport.minX, editor.maxX), viewport.maxX)].compactMap { side, lower, upper -> (String, CGPoint, CGPoint)? in
            let from = CGPoint(x: (lower + upper) / 2, y: application.minY + start.dy)
            let to = CGPoint(x: from.x, y: application.minY + end.dy)
            guard upper > lower, viewport.contains(from), viewport.contains(to),
                  blockers.allSatisfy({ $0.width > 0 && $0.height > 0 && [$0.minX, $0.maxX, $0.minY, $0.maxY].allSatisfy(\.isFinite) }),
                  !blockers.contains(where: { from.x >= $0.minX && from.x <= $0.maxX && max(from.y, to.y) >= $0.minY && min(from.y, to.y) <= $0.maxY }) else { return nil }
            return (side, from, to)
        }
    }
}
