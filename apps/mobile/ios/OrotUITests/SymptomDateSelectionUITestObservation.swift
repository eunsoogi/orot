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

    static func record(_ app: XCUIApplication, beforeRequest: Double, pressStart: Double, pressEnd: Double, afterRequest: Double) {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let payload = marker.exists ? UITestConditions.text(marker) : ""
        let snapshot = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any]
        let native = snapshot?["symptomDateSelection"] as? [String: Any]
        let samples = native?["samples"] as? [String: [String: Any]]
        let before = samples?["before"], after = samples?["after"]
        let valid = correlated(before: before, after: after, session: native?["session"] as? String,
                               beforeRequest: beforeRequest, pressStart: pressStart, pressEnd: pressEnd, afterRequest: afterRequest)
        let result: [String: Any] = ["status": valid ? "correlated" : "unavailable", "beforeRequestMs": beforeRequest,
                                     "pressStartMs": pressStart, "pressEndMs": pressEnd, "afterRequestMs": afterRequest,
                                     "before": before as Any? ?? NSNull(), "after": after as Any? ?? NSNull()]
        let data = (try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])) ?? Data("{}".utf8)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "synthetic-date-selection"
        attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: "Synthetic date selection observation") { $0.add(attachment) }
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
    }
}
