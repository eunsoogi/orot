import CoreGraphics
import Foundation

/// Plans a journal drag from one native sample and the independently measured AX usable viewport.
enum FormScrollGeometryJournalPlan {
    struct Plan {
        let start: CGVector
        let end: CGVector
        let target: CGRect?
        let viewport: CGRect
    }

    /// Report captured candidates without choosing or executing a gesture.
    static func reportSideSegments(application: CGRect, viewport: CGRect, editor: CGRect, blockers: [CGRect], start: CGVector, end: CGVector) {
        let candidates = FormScrollGeometry.journalSideSegments(application: application, viewport: viewport, editor: editor, blockers: blockers, start: start, end: end)
            .map { "\($0.side): \($0.from) -> \($0.to)" }
        print("Side gutter segments: \(candidates.isEmpty ? "no clear candidate" : candidates.joined(separator: "; "))")
    }

    static func make(snapshot: [String: Any]?, application: CGRect, usableViewport: CGRect, keyboard: CGRect?, earlierKeyboard: CGRect? = nil, controls: [CGRect], identifier: String, evaluationStartedAtMs: Double, readEndedAtMs: Double, maximumScrollFraction: CGFloat) -> Plan? {
        guard ["symptom-description", "symptom-status-active", "symptom-form-error"].contains(identifier), FormScrollGeometry.valid(application), FormScrollGeometry.valid(usableViewport),
              controls.allSatisfy(FormScrollGeometry.valid), let snapshot, let markerAt = snapshot["atMs"] as? Double,
              let trace = snapshot["symptomScrollTrace"] as? [String: Any], let accessory = trace["descriptionAccessory"] as? [String: Any],
              accessory["truncated"] as? Bool == false, accessory["inputCount"] as? Int == 1,
              let input = (accessory["inputs"] as? [[String: Any]])?.only, let geometry = input["geometry"] as? [String: Any],
              geometry["status"] as? String == "sampled", geometry["ancestorTraversalComplete"] as? Bool == true,
              geometry["outerComponentCount"] as? Int == 1, geometry["accessibilityViewIsInput"] as? Bool == true,
              let context = geometry["interaction"] as? [String: Any], context["clippingGeometryComplete"] as? Bool == true,
              context["modelClipIntersectionEmpty"] as? Bool == true, context["modelClipIntersection"] is NSNull,
              let geometryAt = geometry["atMs"] as? Double, let contextStart = context["startedAtMs"] as? Double, let contextEnd = context["endedAtMs"] as? Double,
              let declared = geometry["declaredControls"] as? [String: Any], declared["truncated"] as? Bool == false,
              declared["selectionComplete"] as? Bool == true, declared["selectedScrollCount"] as? Int == 1,
              let startAt = declared["startedAtMs"] as? Double, let endAt = declared["endedAtMs"] as? Double,
              [evaluationStartedAtMs, geometryAt, contextStart, contextEnd, startAt, endAt, markerAt, readEndedAtMs].allSatisfy(\.isFinite),
              evaluationStartedAtMs <= geometryAt, geometryAt <= contextStart, contextStart <= contextEnd,
              contextEnd <= startAt, startAt <= endAt, endAt <= markerAt, markerAt <= readEndedAtMs,
              let windowID = declared["windowID"] as? String, !windowID.isEmpty, geometry["windowIdentity"] as? String == windowID,
              context["windowIdentity"] as? String == windowID, let screen = frame(context["windowFrameInScreen"]), same(screen, application),
              let bounds = frame(context["windowBounds"]), same(bounds, screen),
              let scroll = context["scroll"] as? [String: Any], scroll["clipsToBounds"] as? Bool == true,
              scroll["isDragging"] as? Bool == false, scroll["isDecelerating"] as? Bool == false, scroll["isTracking"] as? Bool == false,
              let scrollView = scroll["view"] as? [String: Any], let scrollID = scrollView["identity"] as? String,
              let nativeKeyboards = keyboardFootprints(keyboard, earlier: earlierKeyboard, trace: trace, declared: declared, scrollID: scrollID, application: application, before: startAt, allowInitialAbsence: identifier == "symptom-description"),
              let scrollFrame = frame(scrollView["windowFrame"]), scrollView["sameWindow"] as? Bool == true,
              let selected = declared["scroll"] as? [String: Any], selected["id"] as? String == scrollID,
              selected["tracking"] as? Bool == false, selected["dragging"] as? Bool == false, selected["decelerating"] as? Bool == false,
              sameValues(scroll["contentOffset"], selected["offset"], keys: ["x", "y"]),
              sameValues(scroll["contentSize"], selected["size"], keys: ["width", "height"]),
              let nativeBounds = frame(scrollView["bounds"]), let selectedBounds = frame(selected["bounds"]), same(nativeBounds, selectedBounds),
              let groups = declared["controls"] as? [[String: Any]], let editor = unique("symptom-description", groups: groups, window: windowID, scroll: scrollID),
              editor["clippingComplete"] as? Bool == true, editor["clippedFrameEmpty"] as? Bool == true,
              let editorID = editor["id"] as? String, !editorID.isEmpty, editorID != "unavailable",
              let nativeInput = geometry["input"] as? [String: Any], nativeInput["identity"] as? String == editorID,
              let publicInput = geometry["accessibilityView"] as? [String: Any], publicInput["identity"] as? String == editorID,
              let editorFrame = frame(editor["frame"]), let inputFrame = frame(nativeInput["windowFrame"]), let publicFrame = frame(publicInput["windowFrame"]), same(editorFrame, inputFrame), same(editorFrame, publicFrame),
              let target = unique(identifier, groups: groups, window: windowID, scroll: scrollID),
              target["clippingComplete"] as? Bool == true, let targetID = target["id"] as? String, !targetID.isEmpty, targetID != "unavailable", let targetFrame = frame(target["frame"]),
              identifier == "symptom-description" ? (targetID == editorID && same(targetFrame, editorFrame)) : targetID != editorID
        else { return nil }
        guard let nativeControls = dockBlockers(declared: declared, window: windowID),
              earlierKeyboard.map(FormScrollGeometry.valid) ?? true else { return nil }
        let nativeViewport = usableViewport.intersection(scrollFrame).intersection(application)
        guard let layout = FormScrollGeometry(application: application, scroll: nativeViewport, keyboard: keyboard, reservedKeyboard: nativeKeyboards.first),
              !layout.contains(targetFrame), let x = layout.horizontalPosition(outside: editorFrame),
              let gesture = layout.gesture(target: targetFrame, towardTop: false, horizontalPosition: x, maximumScrollFraction: maximumScrollFraction)
        else { return nil }
        let blockers = [editorFrame, targetFrame] + nativeKeyboards + controls + nativeControls + [keyboard, earlierKeyboard].compactMap(\.self)
        guard let segment = FormScrollGeometry.journalSideSegments(application: application, viewport: layout.viewport, editor: editorFrame, blockers: blockers, start: gesture.start, end: gesture.end).last else { return nil }
        return Plan(start: CGVector(dx: segment.from.x - application.minX, dy: segment.from.y - application.minY), end: CGVector(dx: segment.to.x - application.minX, dy: segment.to.y - application.minY), target: targetFrame, viewport: layout.viewport)
    }

    private static func unique(_ role: String, groups: [[String: Any]], window: String, scroll: String) -> [String: Any]? {
        guard let group = groups.filter({ $0["role"] as? String == role }).only, group["count"] as? Int == 1,
              group["truncated"] as? Bool == false, let candidate = (group["candidates"] as? [[String: Any]])?.only,
              candidate["windowID"] as? String == window, candidate["nearestScrollID"] as? String == scroll,
              candidate["sameSelectedScroll"] as? Bool == true, candidate["hidden"] as? Bool == false,
              candidate["ancestorHidden"] as? Bool == false, let alpha = candidate["alpha"] as? Double, alpha.isFinite, alpha > 0
        else { return nil }
        return candidate
    }

    private static func dockBlockers(declared: [String: Any], window: String) -> [CGRect]? {
        guard let dock = declared["dock"] as? [String: Any], dock["complete"] as? Bool == true,
              dock["windowID"] as? String == window, let controls = dock["controls"] as? [[String: Any]], !controls.isEmpty else { return nil }
        var ids = Set<String>(), result: [CGRect] = []
        for control in controls {
            guard let id = control["id"] as? String, !id.isEmpty, id != "unavailable", ids.insert(id).inserted,
                  let value = frame(control["frame"]) else { return nil }
            result.append(value)
        }
        return result
    }

    private static func keyboardFootprints(_ keyboard: CGRect?, earlier: CGRect?, trace: [String: Any], declared: [String: Any], scrollID: String, application: CGRect, before: Double, allowInitialAbsence: Bool) -> [CGRect]? {
        guard let traceID = trace["traceID"] as? String, !traceID.isEmpty, let events = trace["events"] as? [[String: Any]] else { return nil }
        let keyboardEvents = events.filter { $0["event"] as? String == "symptom-native-keyboard-frame" }
        // Initial absence is an observed state, not a claim about unobserved keyboard configurations.
        if keyboardEvents.isEmpty {
            guard allowInitialAbsence, keyboard == nil, earlier == nil, declared["focusCount"] as? Int == 0,
                  declared["otherWindowFocusCount"] as? Int == 0, declared["focusRole"] as? String == "none",
                  trace["droppedCount"] as? Int == 0, trace["recordedCount"] as? Int == events.count,
                  let selection = trace["selection"] as? [String: Any], selection["attached"] as? Bool == true,
                  selection["reason"] as? String == "attached", selection["scrollViewID"] as? String == scrollID,
                  let first = events.first, first["event"] as? String == "symptom-native-scroll-trace",
                  first["phase"] as? String == "attached", first["traceID"] as? String == traceID,
                  first["scrollViewID"] as? String == scrollID, first["sequence"] as? Int == 1,
                  let attachedAt = first["receivedAtMs"] as? Double, attachedAt.isFinite, attachedAt <= before else { return nil }
            return []
        }
        guard zip(keyboardEvents, keyboardEvents.dropFirst()).allSatisfy({ first, second in
            guard let left = first["sequence"] as? Int, let right = second["sequence"] as? Int,
                  let earlier = first["receivedAtMs"] as? Double, let later = second["receivedAtMs"] as? Double else { return false }
            return left < right && earlier.isFinite && later.isFinite && earlier <= later
        }), let latest = keyboardEvents.last,
        latest["traceID"] as? String == traceID, latest["scrollViewID"] as? String == scrollID,
        let sequence = latest["sequence"] as? Int, sequence > 0,
        latest["phase"] as? String == "did-change-frame", let at = latest["receivedAtMs"] as? Double, at.isFinite, at <= before,
        let native = frame(latest["endFrameInScreen"])
        else { return nil }
        guard let keyboard else { return native.intersects(application) ? nil : [native] }
        guard FormScrollGeometry.valid(keyboard), native.intersects(application), native.insetBy(dx: -0.0001, dy: -0.0001).contains(keyboard) else { return nil }
        return [native]
    }

    private static func frame(_ value: Any?) -> CGRect? {
        guard let value = value as? [String: Double], let x = value["x"], let y = value["y"], let width = value["width"], let height = value["height"] else { return nil }
        let frame = CGRect(x: x, y: y, width: width, height: height)
        return FormScrollGeometry.valid(frame) ? frame : nil
    }

    private static func same(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        zip([lhs.minX, lhs.minY, lhs.width, lhs.height], [rhs.minX, rhs.minY, rhs.width, rhs.height]).allSatisfy { abs($0 - $1) <= 0.0001 }
    }

    private static func sameValues(_ first: Any?, _ second: Any?, keys: [String]) -> Bool {
        guard let lhs = first as? [String: Double], let rhs = second as? [String: Double] else { return false }
        return keys.allSatisfy { key in
            guard let left = lhs[key], let right = rhs[key], left.isFinite, right.isFinite else { return false }
            return abs(left - right) <= 0.0001
        }
    }
}

private extension Array {
    var only: Element? {
        count == 1 ? first : nil
    }
}
