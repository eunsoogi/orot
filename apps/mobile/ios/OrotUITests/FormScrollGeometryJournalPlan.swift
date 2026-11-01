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

    static func make(snapshot: [String: Any]?, application: CGRect, usableViewport: CGRect, keyboard: CGRect?, controls: [CGRect], identifier: String, evaluationStartedAtMs: Double, readEndedAtMs: Double, maximumScrollFraction: CGFloat) -> Plan? {
        guard identifier == "symptom-status-active", FormScrollGeometry.valid(application), FormScrollGeometry.valid(usableViewport),
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
              let nativeKeyboard = keyboardFootprint(keyboard, trace: trace, scrollID: scrollID, application: application, before: startAt),
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
              target["clippingComplete"] as? Bool == true, let targetID = target["id"] as? String, !targetID.isEmpty, targetID != editorID, targetID != "unavailable", let targetFrame = frame(target["frame"])
        else { return nil }
        let nativeViewport = usableViewport.intersection(scrollFrame).intersection(application)
        guard same(nativeViewport, usableViewport), !nativeKeyboard.intersects(nativeViewport), let layout = FormScrollGeometry(application: application, scroll: nativeViewport, keyboard: keyboard),
              same(layout.viewport, nativeViewport), !layout.contains(targetFrame), let x = layout.horizontalPosition(outside: editorFrame),
              let gesture = layout.gesture(target: targetFrame, towardTop: false, horizontalPosition: x, maximumScrollFraction: maximumScrollFraction)
        else { return nil }
        let nativeControls = blockers(groups: groups, window: windowID)
        guard let nativeControls, !nativeControls.isEmpty, nativeControls.count == controls.count,
              !hasDuplicates(nativeControls), !hasDuplicates(controls),
              controls.allSatisfy({ ax in nativeControls.contains { same($0, ax) } }),
              nativeControls.allSatisfy({ native in controls.contains { same($0, native) } }) else { return nil }
        let blockers = [editorFrame, targetFrame, nativeKeyboard] + controls + nativeControls + (keyboard.map { [$0] } ?? [])
        guard let segment = FormScrollGeometry.journalSideSegments(application: application, viewport: nativeViewport, editor: editorFrame, blockers: blockers, start: gesture.start, end: gesture.end).last else { return nil }
        return Plan(start: CGVector(dx: segment.from.x - application.minX, dy: segment.from.y - application.minY), end: CGVector(dx: segment.to.x - application.minX, dy: segment.to.y - application.minY), target: targetFrame, viewport: nativeViewport)
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

    private static func blockers(groups: [[String: Any]], window: String) -> [CGRect]? {
        let roles = ["symptom-save", "symptom-form-cancel", "navigation-page-action-overflow", "navigation-back", "navigation-home"]
        var result: [CGRect] = []
        for role in roles {
            guard let group = groups.filter({ $0["role"] as? String == role }).only, let count = group["count"] as? Int,
                  count <= 1, group["truncated"] as? Bool == false, let candidates = group["candidates"] as? [[String: Any]], candidates.count == count
            else { return nil }
            if let candidate = candidates.first {
                guard candidate["windowID"] as? String == window, candidate["hidden"] as? Bool == false,
                      candidate["ancestorHidden"] as? Bool == false, candidate["clippingComplete"] as? Bool == true,
                      let alpha = candidate["alpha"] as? Double, alpha.isFinite, alpha > 0, let value = frame(candidate["frame"]) else { return nil }
                result.append(value)
            }
        }
        return result
    }

    private static func keyboardFootprint(_ keyboard: CGRect?, trace: [String: Any], scrollID: String, application: CGRect, before: Double) -> CGRect? {
        guard let traceID = trace["traceID"] as? String, !traceID.isEmpty, let events = trace["events"] as? [[String: Any]] else { return nil }
        let keyboardEvents = events.filter { $0["event"] as? String == "symptom-native-keyboard-frame" }
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
        guard let keyboard else { return native.intersects(application) ? nil : native }
        guard FormScrollGeometry.valid(keyboard), native.intersects(application), native.insetBy(dx: -0.0001, dy: -0.0001).contains(keyboard) else { return nil }
        return native
    }

    private static func frame(_ value: Any?) -> CGRect? {
        guard let value = value as? [String: Double], let x = value["x"], let y = value["y"], let width = value["width"], let height = value["height"] else { return nil }
        let frame = CGRect(x: x, y: y, width: width, height: height)
        return FormScrollGeometry.valid(frame) ? frame : nil
    }

    private static func same(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        zip([lhs.minX, lhs.minY, lhs.width, lhs.height], [rhs.minX, rhs.minY, rhs.width, rhs.height]).allSatisfy { abs($0 - $1) <= 0.0001 }
    }

    private static func hasDuplicates(_ frames: [CGRect]) -> Bool {
        for (index, frame) in frames.enumerated() where frames.dropFirst(index + 1).contains(where: { same(frame, $0) }) {
            return true
        }
        return false
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
