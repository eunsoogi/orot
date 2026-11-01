import CoreFoundation
import XCTest

/// Correlates two one-shot native receipts without repeating the original selection gesture.
@MainActor
enum SymptomDateSelectionUITestObservation {
    static let session = UUID().uuidString
    static var enabled: Bool {
        ProcessInfo.processInfo.environment["OROT_SYMPTOM_MENU_OBSERVATION"] == "1" && ProcessInfo.processInfo.environment["OROT_IOS_FIXTURE_SESSION"] != nil
    }

    static func request(_ phase: String) -> Double {
        let time = Date().timeIntervalSince1970 * 1000
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName("com.orot.tests.date-selection.\(session).\(phase)" as CFString), nil, nil, true)
        return time
    }

    static func record(_ app: XCUIApplication, beforeRequest: Double, pressStart: Double, pressEnd: Double, afterRequest: Double, planRetap: Bool) -> CGPoint? {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let payload = marker.exists ? UITestConditions.text(marker) : ""
        let snapshot = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any]
        let native = snapshot?["symptomDateSelection"] as? [String: Any]
        let samples = native?["samples"] as? [String: [String: Any]]
        let before = samples?["before"], after = samples?["after"]
        let valid = correlated(before: before, after: after, session: native?["session"] as? String,
                               beforeRequest: beforeRequest, pressStart: pressStart, pressEnd: pressEnd, afterRequest: afterRequest)
        let point: CGPoint? = if planRetap, valid, let after, let markerAt = snapshot?["atMs"] as? Double,
                                 let ended = after["endedAtMs"] as? Double, ended <= markerAt
        {
            retapPoint(app, after: after, trace: snapshot?["symptomScrollTrace"] as? [String: Any])
        } else {
            nil
        }
        let result: [String: Any] = ["status": valid ? "correlated" : "unavailable", "beforeRequestMs": beforeRequest,
                                     "pressStartMs": pressStart, "pressEndMs": pressEnd, "afterRequestMs": afterRequest,
                                     "before": before as Any? ?? NSNull(), "after": after as Any? ?? NSNull(),
                                     "retapPlan": point.map { ["x": $0.x, "y": $0.y] } as Any? ?? NSNull()]
        let data = (try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])) ?? Data("{}".utf8)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "synthetic-date-selection"
        attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: "Synthetic date selection observation") { $0.add(attachment) }
        return point
    }

    /// A planned point is used only when current AX geometry agrees with the one-shot native selection sample.
    private static func retapPoint(_ app: XCUIApplication, after: [String: Any], trace: [String: Any]?) -> CGPoint? {
        guard let geometry = after["selectionGeometry"] as? [String: Any], geometry["hitOwned"] as? Bool == true,
              let selected = frame(geometry["selection"]), let nativeField = frame(geometry["field"]), let nativeWindow = frame(geometry["window"]),
              let orientation = geometry["orientation"] as? Int, matchesOrientation(orientation),
              let start = after["selectionStart"] as? Int, let end = after["selectionEnd"] as? Int, start < end else { return nil }
        let input = app.textFields.matching(identifier: "symptom-onset-date")
        guard input.count == 1 else { return nil }
        let field = input.element(boundBy: 0), appFrame = app.frame
        guard field.exists, field.isHittable, same(field.frame, nativeField), same(appFrame, nativeWindow), nativeField.contains(selected), appFrame.contains(selected) else { return nil }
        let point = CGPoint(x: selected.midX, y: selected.midY)
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            let value = keyboard.frame
            guard valid(value), !value.intersects(selected) else { return nil }
        }
        guard safeNativeEvidence(trace: trace, after: after, geometry: geometry, appFrame: appFrame, nativeField: nativeField, nativeWindow: nativeWindow, selected: selected) else { return nil }
        let overlay = UITestConditions.element(app, "navigation-action-bar-overlay")
        guard overlay.exists else { return nil }
        let buttons = overlay.descendants(matching: .button).allElementsBoundByIndex
        guard !buttons.isEmpty, buttons.allSatisfy(\.exists), safeButtons(buttons.map(\.frame), selected: selected) else { return nil }
        return CGPoint(x: point.x - appFrame.minX, y: point.y - appFrame.minY)
    }

    private static func safeNativeEvidence(trace: [String: Any]?, after: [String: Any], geometry: [String: Any], appFrame: CGRect, nativeField: CGRect, nativeWindow: CGRect, selected: CGRect) -> Bool {
        guard let trace, let events = trace["events"] as? [[String: Any]], let traceID = trace["traceID"] as? String, !traceID.isEmpty,
              let recorded = trace["recordedCount"] as? Int, let dropped = trace["droppedCount"] as? Int, recorded == dropped + events.count,
              let last = events.last, last["sequence"] as? Int == recorded,
              zip(events, events.dropFirst()).allSatisfy({ first, second in
                  guard let a = first["sequence"] as? Int, let b = second["sequence"] as? Int else { return false }
                  return a + 1 == b
              }),
              let selection = trace["selection"] as? [String: Any], selection["attached"] as? Bool == true,
              selection["keyWindowCount"] as? Int == 1, let traceScrollID = selection["scrollViewID"] as? String,
              let accessory = trace["descriptionAccessory"] as? [String: Any], accessory["truncated"] as? Bool == false,
              let inputs = accessory["inputs"] as? [[String: Any]], inputs.count == 1,
              let sample = inputs[0]["geometry"] as? [String: Any], let context = sample["interaction"] as? [String: Any],
              let contextEnd = context["endedAtMs"] as? Double, let afterStart = after["startedAtMs"] as? Double, contextEnd <= afterStart,
              let contextWindow = frame(context["windowFrameInScreen"]), same(contextWindow, nativeWindow),
              let traceScroll = context["scroll"] as? [String: Any], traceScroll["isTracking"] as? Bool == false,
              traceScroll["isDragging"] as? Bool == false, traceScroll["isDecelerating"] as? Bool == false,
              let traceView = traceScroll["view"] as? [String: Any], traceView["identity"] as? String == traceScrollID,
              let traceFrame = frame(traceView["windowFrame"]), let traceBounds = frame(traceView["bounds"]),
              let nativeScroll = geometry["scroll"] as? [String: Any], let scrollFrame = frame(nativeScroll["frame"]),
              let scrollBounds = frame(nativeScroll["bounds"]), same(scrollFrame, traceFrame.offsetBy(dx: appFrame.minX, dy: appFrame.minY)), same(scrollBounds, traceBounds),
              samePoint(nativeScroll["offset"], traceScroll["contentOffset"]),
              let declared = sample["declaredControls"] as? [String: Any], declared["selectionComplete"] as? Bool == true, declared["truncated"] as? Bool == false,
              let groups = declared["controls"] as? [[String: Any]], let date = groups.filter({ $0["role"] as? String == "symptom-onset-date" }).first,
              groups.filter({ $0["role"] as? String == "symptom-onset-date" }).count == 1, date["count"] as? Int == 1, date["truncated"] as? Bool == false,
              let candidates = date["candidates"] as? [[String: Any]], candidates.count == 1, let candidate = candidates.first,
              candidate["firstResponder"] as? Bool == true, candidate["sameSelectedScroll"] as? Bool == true,
              candidate["nearestScrollID"] as? String == traceScrollID, candidate["windowID"] as? String == context["windowIdentity"] as? String,
              candidate["clippingComplete"] as? Bool == true, let dateFrame = frame(candidate["frame"]), same(dateFrame.offsetBy(dx: appFrame.minX, dy: appFrame.minY), nativeField),
              let dock = after["dock"] as? [String: Any], dock["complete"] as? Bool == true, dock["windowID"] as? String == after["windowID"] as? String,
              let controls = dock["controls"] as? [[String: Any]], !controls.isEmpty else { return false }
        guard let event = events.last(where: { $0["event"] as? String == "symptom-native-keyboard-frame" }),
              event["traceID"] as? String == traceID, event["scrollViewID"] as? String == traceScrollID,
              event["phase"] as? String == "did-change-frame", let at = event["receivedAtMs"] as? Double,
              let afterStart = after["startedAtMs"] as? Double, at.isFinite, at <= afterStart,
              let value = frame(event["endFrameInScreen"]), !value.intersects(selected) else { return false }
        for control in controls {
            guard let value = frame(control["frame"]), !value.offsetBy(dx: appFrame.minX, dy: appFrame.minY).intersects(selected) else { return false }
        }
        return true
    }

    private static func safeButtons(_ buttons: [CGRect], selected: CGRect) -> Bool {
        !buttons.isEmpty && buttons.allSatisfy { valid($0) && !$0.intersects(selected) }
    }

    static func retap(_ app: XCUIApplication, point: CGPoint) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
    }

    private static func matchesOrientation(_ orientation: Int) -> Bool {
        switch XCUIDevice.shared.orientation {
        case .portrait: orientation == 1
        case .portraitUpsideDown: orientation == 2
        case .landscapeLeft: orientation == 4
        case .landscapeRight: orientation == 3
        default: false
        }
    }

    private static func frame(_ value: Any?) -> CGRect? {
        guard let data = value as? [String: Double], let x = data["x"], let y = data["y"], let width = data["width"], let height = data["height"] else { return nil }
        let rect = CGRect(x: x, y: y, width: width, height: height)
        return valid(rect) ? rect : nil
    }

    private static func valid(_ rect: CGRect) -> Bool {
        !rect.isNull && !rect.isInfinite && rect.width > 0 && rect.height > 0 && [rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy(\.isFinite)
    }

    private static func same(_ left: CGRect, _ right: CGRect) -> Bool {
        zip([left.minX, left.minY, left.width, left.height], [right.minX, right.minY, right.width, right.height]).allSatisfy { abs($0 - $1) <= 0.0001 }
    }

    private static func samePoint(_ first: Any?, _ second: Any?) -> Bool {
        guard let first = first as? [String: Double], let second = second as? [String: Double] else { return false }
        return ["x", "y"].allSatisfy { key in
            guard let left = first[key], let right = second[key], left.isFinite, right.isFinite else { return false }
            return abs(left - right) <= 0.0001
        }
    }

    static func correlated(before: [String: Any]?, after: [String: Any]?, session: String?, beforeRequest: Double, pressStart: Double, pressEnd: Double, afterRequest: Double) -> Bool {
        guard session == self.session, let before, let after,
              before["phase"] as? String == "before", after["phase"] as? String == "after",
              before["status"] as? String == "available", after["status"] as? String == "available",
              before["sampleCount"] as? Int == 1, after["sampleCount"] as? Int == 1,
              before["focused"] as? Bool == true, after["focused"] as? Bool == true,
              let view = before["viewID"] as? String, !view.isEmpty, view != "unavailable", after["viewID"] as? String == view,
              let window = before["windowID"] as? String, !window.isEmpty, window != "unavailable", after["windowID"] as? String == window,
              let length = before["documentLength"] as? Int, length >= 0, after["documentLength"] as? Int == length,
              [before, after].allSatisfy({ sample in
                  guard let start = sample["selectionStart"] as? Int, let end = sample["selectionEnd"] as? Int else { return false }
                  return start >= 0 && start <= end && end <= length
              }),
              let firstStart = before["startedAtMs"] as? Double, let firstEnd = before["endedAtMs"] as? Double,
              let lastStart = after["startedAtMs"] as? Double, let lastEnd = after["endedAtMs"] as? Double else { return false }
        return [beforeRequest, firstStart, firstEnd, pressStart, pressEnd, afterRequest, lastStart, lastEnd].allSatisfy(\.isFinite) && beforeRequest <= firstStart && firstStart <= firstEnd && firstEnd <= pressStart && pressStart < pressEnd && pressEnd <= afterRequest && afterRequest <= lastStart && lastStart <= lastEnd
    }

    /// Missing, stale, duplicated or different-owner receipts never establish the press boundary.
    static func verifyCorrelation() {
        let first: [String: Any] = ["phase": "before", "status": "available", "sampleCount": 1, "focused": true, "viewID": "view", "windowID": "window", "documentLength": 10, "selectionStart": 0, "selectionEnd": 0, "startedAtMs": 2.0, "endedAtMs": 3.0]
        let last: [String: Any] = ["phase": "after", "status": "available", "sampleCount": 1, "focused": true, "viewID": "view", "windowID": "window", "documentLength": 10, "selectionStart": 0, "selectionEnd": 10, "startedAtMs": 7.0, "endedAtMs": 8.0]
        func accepts(_ before: [String: Any]?, _ after: [String: Any]?, _ receiptSession: String?) -> Bool {
            correlated(before: before, after: after, session: receiptSession, beforeRequest: 1, pressStart: 4, pressEnd: 5, afterRequest: 6)
        }
        XCTAssertTrue(accepts(first, last, session))
        XCTAssertFalse(accepts(nil, last, session))
        XCTAssertFalse(accepts(first, last, UUID().uuidString))
        for changed: [String: Any] in [["sampleCount": 2], ["windowID": "other"], ["viewID": "other"], ["startedAtMs": 4.5], ["focused": false], ["documentLength": 9], ["selectionEnd": 11]] {
            XCTAssertFalse(accepts(first.merging(changed) { _, new in new }, last, session))
        }
        verifyRetapEvidence()
    }

    private static func verifyRetapEvidence() {
        let app = CGRect(x: 0, y: 0, width: 400, height: 800), field = CGRect(x: 20, y: 100, width: 200, height: 40), selected = CGRect(x: 30, y: 110, width: 50, height: 20)
        func data(_ r: CGRect) -> [String: Double] {
            ["x": Double(r.minX), "y": Double(r.minY), "width": Double(r.width), "height": Double(r.height)]
        }
        let scroll = CGRect(x: 0, y: 50, width: 400, height: 500), bounds = CGRect(x: 0, y: 0, width: 400, height: 500)
        let scrollData: [String: Any] = ["view": ["identity": "scroll", "windowFrame": data(scroll), "bounds": data(bounds)], "contentOffset": ["x": 0.0, "y": 0.0], "isTracking": false, "isDragging": false, "isDecelerating": false]
        let candidate: [String: Any] = ["firstResponder": true, "sameSelectedScroll": true, "nearestScrollID": "scroll", "windowID": "window", "clippingComplete": true, "frame": data(field)]
        let declared: [String: Any] = ["selectionComplete": true, "truncated": false, "controls": [["role": "symptom-onset-date", "count": 1, "truncated": false, "candidates": [candidate]]]]
        let context: [String: Any] = ["endedAtMs": 5.0, "windowIdentity": "window", "windowFrameInScreen": data(app), "scroll": scrollData]
        let marker: [String: Any] = ["interaction": context, "declaredControls": declared]
        let keyboard: [String: Any] = ["event": "symptom-native-keyboard-frame", "traceID": "trace", "scrollViewID": "scroll", "sequence": 1, "phase": "did-change-frame", "receivedAtMs": 1.0, "endFrameInScreen": data(CGRect(x: 0, y: 600, width: 400, height: 200))]
        let trace: [String: Any] = ["events": [keyboard], "traceID": "trace", "recordedCount": 1, "droppedCount": 0, "selection": ["attached": true, "keyWindowCount": 1, "scrollViewID": "scroll"], "descriptionAccessory": ["truncated": false, "inputs": [["geometry": marker]]]]
        let after: [String: Any] = ["startedAtMs": 6.0, "windowID": "window", "dock": ["complete": true, "windowID": "window", "controls": [["frame": data(CGRect(x: 0, y: 550, width: 40, height: 40))]]]]
        let geometry: [String: Any] = ["scroll": ["frame": data(scroll), "bounds": data(bounds), "offset": ["x": 0.0, "y": 0.0]]]
        func safe(_ trace: [String: Any]?, _ after: [String: Any]) -> Bool {
            safeNativeEvidence(trace: trace, after: after, geometry: geometry, appFrame: app, nativeField: field, nativeWindow: app, selected: selected)
        }
        XCTAssertTrue(safe(trace, after))
        XCTAssertFalse(safe(nil, after))
        XCTAssertFalse(safe(trace.merging(["events": [["event": "symptom-native-scroll-trace", "sequence": 1]]]) { _, new in new }, after))
        XCTAssertFalse(safe(trace, after.merging(["windowID": "other"]) { _, new in new }))
        XCTAssertFalse(safe(trace, after.merging(["startedAtMs": 4.0]) { _, new in new }))
        let moving = marker.merging(["interaction": context.merging(["scroll": scrollData.merging(["isDragging": true]) { _, new in new }]) { _, new in new }]) { _, new in new }
        XCTAssertFalse(safe(trace.merging(["descriptionAccessory": ["truncated": false, "inputs": [["geometry": moving]]]]) { _, new in new }, after))
        XCTAssertFalse(safeButtons([], selected: selected))
        XCTAssertFalse(safeButtons([selected], selected: selected))
    }
}
