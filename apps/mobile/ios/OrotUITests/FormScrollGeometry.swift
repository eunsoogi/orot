import CoreGraphics
import Foundation

/// Compute one gesture from captured public frames, in UIKit points. Never combine later AX reads with these coordinates.
struct FormScrollGeometry {
    let application: CGRect
    let viewport: CGRect
    private static let coordinateTolerance: CGFloat = 0.0001

    init?(application: CGRect, scroll: CGRect, keyboard: CGRect?, reservedKeyboard: CGRect? = nil) {
        guard Self.valid(application), Self.valid(scroll) else { return nil }
        var visible = scroll.intersection(application)
        // A supplied reservation is a constraint, not an observation that the keyboard is currently present.
        for keyboard in [keyboard, reservedKeyboard].compactMap(\.self) {
            guard Self.valid(keyboard) else { return nil }
            visible.size.height = min(visible.maxY, keyboard.minY) - visible.minY
        }
        guard Self.valid(visible) else { return nil }
        self.application = application
        viewport = visible
    }

    /// Derive clipping from this evaluation; an explicit reserved frame is retained only for existing non-journal callers.
    static func current(application: CGRect, scroll: CGRect, keyboard: CGRect?, input: CGRect?, referenceSize: CGSize?, reservedKeyboard: CGRect? = nil) -> Self? {
        guard let geometry = Self(application: application, scroll: scroll, keyboard: keyboard, reservedKeyboard: reservedKeyboard) else { return nil }
        guard let keyboard, let input, let referenceSize else { return geometry }
        guard let reservation = geometry.keyboardReservation(keyboard, for: input, referenceSize: referenceSize) else { return nil }
        return Self(application: application, scroll: scroll, keyboard: keyboard, reservedKeyboard: reservation)
    }

    /// A focused AX frame can contain only the visible slice. Retain the previously observed height as a minimum, not an unproved full extent.
    func contains(_ target: CGRect, referenceSize: CGSize? = nil) -> Bool {
        guard Self.valid(target) else { return false }
        if let referenceSize {
            guard Self.valid(referenceSize), abs(target.width - referenceSize.width) <= Self.coordinateTolerance,
                  target.height + Self.coordinateTolerance >= referenceSize.height else { return false }
        }
        return target.minY >= viewport.minY - Self.coordinateTolerance && target.maxY <= viewport.maxY + Self.coordinateTolerance
    }

    /// The keyboard AX frame can omit its prediction surface. A bottom-clipped input supplies a stricter observed edge for the scroll constraint.
    func keyboardReservation(_ keyboard: CGRect, for target: CGRect, referenceSize: CGSize) -> CGRect? {
        guard Self.valid(keyboard), Self.valid(target), Self.valid(referenceSize),
              abs(target.width - referenceSize.width) <= Self.coordinateTolerance else { return nil }
        // Top clipping or an offscreen keyboard does not establish a new bottom boundary.
        guard keyboard.intersects(application), target.height + Self.coordinateTolerance < referenceSize.height,
              target.minY > viewport.minY + Self.coordinateTolerance else { return keyboard }
        let top = min(keyboard.minY, target.maxY)
        let reservation = CGRect(x: keyboard.minX, y: top, width: keyboard.width, height: keyboard.maxY - top)
        return Self.valid(reservation) ? reservation : nil
    }

    /// Scroll beside a focused editor; dragging within it can move its caret or scroll its text instead of the form.
    func horizontalPosition(outside target: CGRect) -> CGFloat? {
        guard Self.valid(target) else { return nil }
        let leftEnd = min(max(target.minX, viewport.minX), viewport.maxX)
        let rightStart = min(max(target.maxX, viewport.minX), viewport.maxX)
        let left = leftEnd - viewport.minX
        let right = viewport.maxX - rightStart
        guard max(left, right) > 0 else { return nil }
        let x = right >= left ? rightStart + right / 2 : viewport.minX + left / 2
        return (x - viewport.minX) / viewport.width
    }

    func gesture(target: CGRect?, towardTop: Bool, horizontalPosition: CGFloat, maximumScrollFraction: CGFloat = 0.45, verticalBounds: CGRect? = nil) -> (start: CGVector, end: CGVector)? {
        guard horizontalPosition.isFinite, (0 ... 1).contains(horizontalPosition),
              maximumScrollFraction.isFinite, maximumScrollFraction > 0, maximumScrollFraction <= 0.7 else { return nil }
        let measuredTarget = target.flatMap { Self.valid($0) ? $0 : nil }
        // Containment does not imply hittability under system chrome. If reveal
        // still needs a gesture, retain its search direction instead of oscillating
        // across the edge; measured clipping always takes precedence.
        let above = measuredTarget.map { contains($0) ? towardTop : $0.minY < viewport.minY } ?? towardTop
        // A keyboard can appear between AX observation and touch delivery. Stay beside
        // the same visible editor vertically too, without treating that band as visibility proof.
        var gestureViewport = viewport
        if let verticalBounds {
            guard Self.valid(verticalBounds) else { return nil }
            let top = max(viewport.minY, verticalBounds.minY)
            let bottom = min(viewport.maxY, verticalBounds.maxY)
            gestureViewport = CGRect(x: viewport.minX, y: top, width: viewport.width, height: bottom - top)
            guard Self.valid(gestureViewport) else { return nil }
        }
        let travelLimit = gestureViewport.height * maximumScrollFraction
        let overflow = measuredTarget.map { above ? viewport.minY - $0.minY : $0.maxY - viewport.maxY } ?? travelLimit
        // Virtualized lists can opt into longer travel while an offscreen row is being located.
        // The 70% ceiling keeps both endpoints inside the viewport from the existing 25%/75% origins.
        let distance = min(max(overflow + 8, 30), travelLimit)
        let x = viewport.minX + viewport.width * horizontalPosition - application.minX
        let y = gestureViewport.minY + gestureViewport.height * (above ? 0.25 : 0.75) - application.minY
        let endY = y + (above ? distance : -distance)
        guard [x, y, endY].allSatisfy(\.isFinite) else { return nil }
        return (CGVector(dx: x, dy: y), CGVector(dx: x, dy: endY))
    }

    /// Reference dimensions must be finite and positive before comparing observed extents.
    private static func valid(_ size: CGSize) -> Bool {
        size.width.isFinite && size.height.isFinite && size.width > 0 && size.height > 0
    }

    /// Shared with the journal consumer: finite components can still overflow their calculated frame edges.
    static func valid(_ rect: CGRect) -> Bool {
        !rect.isNull && !rect.isInfinite && rect.size.width > 0 && rect.size.height > 0 &&
            [rect.origin.x, rect.origin.y, rect.width, rect.height, rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy(\.isFinite)
    }

    /// Only this evaluation's coherent native sample can resolve an invalid AX editor, never an arbitrary age limit.
    /// Both processes use Unix wall milliseconds; clock/order mismatches fail closed, and AX/native reads remain non-atomic.
    static func clippedJournalEditor(_ snapshot: [String: Any]?, application: CGRect, viewport: CGRect, target: CGRect,
                                     identifier: String, evaluationStartedAtMs: Double, readEndedAtMs: Double,
                                     start: CGVector, end: CGVector) -> CGRect?
    {
        guard valid(application), valid(viewport), valid(target), !identifier.isEmpty, evaluationStartedAtMs.isFinite, readEndedAtMs.isFinite,
              evaluationStartedAtMs <= readEndedAtMs,
              let snapshot, let markerAt = snapshot["atMs"] as? Double,
              let trace = snapshot["symptomScrollTrace"] as? [String: Any],
              let accessory = trace["descriptionAccessory"] as? [String: Any],
              accessory["truncated"] as? Bool == false, accessory["inputCount"] as? Int == 1,
              let inputs = accessory["inputs"] as? [[String: Any]], inputs.count == 1,
              let geometry = inputs[0]["geometry"] as? [String: Any], geometry["status"] as? String == "sampled",
              geometry["outerComponentCount"] as? Int == 1, geometry["ancestorTraversalComplete"] as? Bool == true,
              geometry["accessibilityViewIsInput"] as? Bool == true,
              let sampleAt = geometry["atMs"] as? Double,
              let context = geometry["interaction"] as? [String: Any],
              let nativeStart = context["startedAtMs"] as? Double, let nativeEnd = context["endedAtMs"] as? Double,
              [markerAt, sampleAt, nativeStart, nativeEnd].allSatisfy(\.isFinite),
              evaluationStartedAtMs <= sampleAt, sampleAt <= nativeStart, nativeStart <= nativeEnd,
              nativeEnd <= markerAt, markerAt <= readEndedAtMs,
              let window = geometry["windowIdentity"] as? String, !window.isEmpty, context["windowIdentity"] as? String == window,
              context["scrollCount"] as? Int == 1, context["targetCount"] as? Int == 1,
              context["clippingGeometryComplete"] as? Bool == true, context["modelClipIntersectionEmpty"] as? Bool == true,
              context["modelClipIntersection"] is NSNull,
              let windowBounds = decodedFrame(context["windowBounds"]), let screen = decodedFrame(context["windowFrameInScreen"]),
              sameFrame(screen, application), sameFrame(CGRect(origin: .zero, size: screen.size), CGRect(origin: .zero, size: windowBounds.size)),
              let input = geometry["input"] as? [String: Any], let exposed = geometry["accessibilityView"] as? [String: Any],
              let outer = geometry["outer"] as? [String: Any],
              let inputID = input["identity"] as? String, !inputID.isEmpty, exposed["identity"] as? String == inputID,
              visibleInWindow(geometry["accessibilityViewVisibility"], window: window, identity: inputID),
              let outerID = outer["identity"] as? String, !outerID.isEmpty, outerID != inputID,
              visibleInWindow(geometry["outerVisibility"], window: window, identity: outerID),
              let editor = nativeFrame(input), let publicEditor = nativeFrame(exposed), let outerFrame = nativeFrame(outer),
              sameFrame(editor, publicEditor), outerFrame.insetBy(dx: -coordinateTolerance, dy: -coordinateTolerance).contains(editor),
              let scroll = context["scroll"] as? [String: Any], scroll["clipsToBounds"] as? Bool == true,
              scroll["isDragging"] as? Bool == false, scroll["isDecelerating"] as? Bool == false, scroll["isTracking"] as? Bool == false,
              let scrollView = scroll["view"] as? [String: Any], let scrollID = scrollView["identity"] as? String, !scrollID.isEmpty,
              let scrollFrame = nativeFrame(scrollView),
              let nativeTarget = context["target"] as? [String: Any], nativeTarget["identifier"] as? String == identifier,
              nativeTarget["sameSelectedScroll"] as? Bool == true, nativeTarget["nearestScrollIdentity"] as? String == scrollID,
              let targetView = nativeTarget["view"] as? [String: Any], let targetID = targetView["identity"] as? String, !targetID.isEmpty, targetID != inputID,
              visibleInWindow(nativeTarget["visibility"], window: window, identity: targetID),
              let targetFrame = nativeFrame(targetView),
              let clips = context["clippingAncestors"] as? [[String: Any]],
              clips.contains(where: { $0["identity"] as? String == scrollID }),
              clips.allSatisfy({ nativeFrame($0) != nil && $0["hasLayerMask"] as? Bool == false }) else { return nil }
        let dx = screen.minX - windowBounds.minX
        let dy = screen.minY - windowBounds.minY
        let screenEditor = editor.offsetBy(dx: dx, dy: dy)
        let screenScroll = scrollFrame.offsetBy(dx: dx, dy: dy)
        let first = CGPoint(x: application.minX + start.dx, y: application.minY + start.dy)
        let last = CGPoint(x: application.minX + end.dx, y: application.minY + end.dy)
        guard sameFrame(targetFrame.offsetBy(dx: dx, dy: dy), target), screenEditor.intersection(viewport).isEmpty,
              screenScroll.insetBy(dx: -coordinateTolerance, dy: -coordinateTolerance).contains(viewport),
              [first, last].allSatisfy({ viewport.contains($0) && screenScroll.contains($0) && screen.contains($0) }) else { return nil }
        return screenEditor
    }

    private static func visibleInWindow(_ value: Any?, window: String, identity: String) -> Bool {
        guard let value = value as? [String: Any], let alpha = value["alpha"] as? Double else { return false }
        return value["identity"] as? String == identity && value["windowIdentity"] as? String == window &&
            value["hasWindow"] as? Bool == true && value["windowHidden"] as? Bool == false &&
            value["hidden"] as? Bool == false && value["ancestorHidden"] as? Bool == false &&
            value["visibilityTraversalComplete"] as? Bool == true && alpha.isFinite && alpha > 0
    }

    private static func nativeFrame(_ view: [String: Any]) -> CGRect? {
        view["sameWindow"] as? Bool == true ? decodedFrame(view["windowFrame"]) : nil
    }

    private static func decodedFrame(_ value: Any?) -> CGRect? {
        guard let value = value as? [String: Double], let x = value["x"], let y = value["y"],
              let width = value["width"], let height = value["height"] else { return nil }
        let frame = CGRect(x: x, y: y, width: width, height: height)
        return valid(frame) ? frame : nil
    }

    private static func sameFrame(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        zip([lhs.minX, lhs.minY, lhs.width, lhs.height], [rhs.minX, rhs.minY, rhs.width, rhs.height])
            .allSatisfy { abs($0 - $1) <= coordinateTolerance }
    }

    /// Preserve the existing complete-segment gutter test, including target and visible navigation blockers.
    static func journalSideSegments(application: CGRect, viewport: CGRect, editor: CGRect, blockers: [CGRect], start: CGVector, end: CGVector) -> [(side: String, from: CGPoint, to: CGPoint)] {
        [("left", viewport.minX, min(viewport.maxX, editor.minX)), ("right", max(viewport.minX, editor.maxX), viewport.maxX)].compactMap { side, lower, upper -> (String, CGPoint, CGPoint)? in
            let from = CGPoint(x: (lower + upper) / 2, y: application.minY + start.dy)
            let to = CGPoint(x: from.x, y: application.minY + end.dy)
            guard upper > lower, viewport.contains(from), viewport.contains(to),
                  blockers.allSatisfy({ valid($0) }),
                  !blockers.contains(where: { from.x >= $0.minX && from.x <= $0.maxX && max(from.y, to.y) >= $0.minY && min(from.y, to.y) <= $0.maxY }) else { return nil }
            return (side, from, to)
        }
    }
}
