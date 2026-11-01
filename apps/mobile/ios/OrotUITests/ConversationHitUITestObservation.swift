import CoreFoundation
import XCTest

/// Records only geometry and state after the original Send assertion has already failed.
@MainActor
enum ConversationHitUITestObservation {
    struct Initial {
        let startedAtMs: Double
        let endedAtMs: Double
        let enabled: Bool
        let hittable: Bool
    }

    /// Reject stale, invalid, or incomplete receipts before a real failed assertion can use them.
    static func validatedSession() -> String {
        let session = UUID().uuidString
        let initial = Initial(startedAtMs: 1, endedAtMs: 2, enabled: true, hittable: false)
        let sample: [String: Any] = ["status": "available", "ancestorComplete": true, "windowID": "window", "sendWindowID": "window", "startedAtMs": 5.0, "endedAtMs": 6.0]
        let valid: [String: Any] = ["session": session, "sampleCount": 1, "receivedAtMs": 4.0, "sample": sample]
        XCTAssertTrue(correlated(valid, markerAt: 7, initial: initial, requestAt: 3, session: session))
        XCTAssertFalse(correlated(valid, markerAt: .infinity, initial: initial, requestAt: 3, session: session))
        XCTAssertFalse(correlated(valid, markerAt: 5, initial: initial, requestAt: 3, session: session))
        XCTAssertFalse(correlated(valid, markerAt: 7, initial: initial, requestAt: 3, session: UUID().uuidString))
        for changed: [String: Any] in [["status": "truncated"], ["ancestorComplete": false], ["windowID": "unavailable", "sendWindowID": "unavailable"]] {
            let modified = sample.merging(changed, uniquingKeysWith: { _, new in new })
            XCTAssertFalse(correlated(valid.merging(["sample": modified], uniquingKeysWith: { _, new in new }), markerAt: 7, initial: initial, requestAt: 3, session: session))
        }
        return session
    }

    static func sample(_ send: XCUIElement) -> Initial {
        let start = Date().timeIntervalSince1970 * 1000
        let enabled = send.isEnabled
        let hittable = send.isHittable
        return Initial(startedAtMs: start, endedAtMs: Date().timeIntervalSince1970 * 1000, enabled: enabled, hittable: hittable)
    }

    static func assertSendReady(_ app: XCUIApplication, send: XCUIElement, session: String, testCase: XCTestCase) {
        let initial = sample(send)
        if !initial.enabled || !initial.hittable {
            capture(app, send: send, initial: initial, session: session, testCase: testCase)
        }
        XCTAssertTrue(initial.enabled)
        XCTAssertTrue(initial.hittable)
    }

    static func capture(_ app: XCUIApplication, send: XCUIElement, initial: Initial, session: String, testCase: XCTestCase) {
        let request = Date().timeIntervalSince1970 * 1000
        let notification = CFNotificationName("com.orot.tests.conversation-hit.\(session)" as CFString)
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), notification, nil, nil, true)
        let started = Date().timeIntervalSince1970 * 1000
        let history = UITestConditions.element(app, "rag-conversation-history")
        let keyboard = app.keyboards.firstMatch
        let roles = ["rag-conversation-sessions-toggle", "rag-conversation-new-session", "navigation-page-action-overflow", "navigation-toolbar"]
        func sample(_ element: XCUIElement) -> [String: Any] {
            let exists = element.exists
            return ["exists": exists, "frame": exists ? String(describing: element.frame) : "unavailable", "hittable": exists && element.isHittable]
        }
        let sendSample = sample(send)
        let historySample = sample(history)
        let keyboardSample = sample(keyboard)
        let controls = Dictionary(uniqueKeysWithValues: roles.map { ($0, sample(UITestConditions.element(app, $0))) })
        let ended = Date().timeIntervalSince1970 * 1000
        let payload: [String: Any] = ["initial": ["startedAtMs": initial.startedAtMs, "endedAtMs": initial.endedAtMs, "enabled": initial.enabled, "hittable": initial.hittable], "requestAtMs": request, "startedAtMs": started, "endedAtMs": ended, "send": sendSample, "history": historySample, "keyboard": keyboardSample, "controls": controls]
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])) ?? Data()
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "conversation-hit-ax"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        // A missing or stale acknowledgement is evidence unavailable, never a substitute for the failed assertion.
        let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "conversation-hit-native-\(session)")
        let native = snapshot?["conversationHit"] as? [String: Any]
        let matched = correlated(native, markerAt: snapshot?["atMs"] as? Double, initial: initial, requestAt: request, session: session)
        let status = XCTAttachment(string: matched ? "correlated model geometry" : "unavailable, stale, or ambiguous sample")
        status.name = "conversation-hit-correlation"
        status.lifetime = .keepAlways
        testCase.add(status)
    }

    static func correlated(_ native: [String: Any]?, markerAt: Double?, initial: Initial, requestAt: Double, session: String) -> Bool {
        guard native?["session"] as? String == session, native?["sampleCount"] as? Int == 1,
              let received = native?["receivedAtMs"] as? Double, let sample = native?["sample"] as? [String: Any],
              sample["status"] as? String == "available", sample["ancestorComplete"] as? Bool == true,
              let windowID = sample["windowID"] as? String, !windowID.isEmpty, windowID != "unavailable", sample["sendWindowID"] as? String == windowID,
              let started = sample["startedAtMs"] as? Double, let ended = sample["endedAtMs"] as? Double, let markerAt
        else { return false }
        return [initial.startedAtMs, initial.endedAtMs, requestAt, received, started, ended, markerAt].allSatisfy(\.isFinite) && initial.startedAtMs <= initial.endedAtMs && initial.endedAtMs <= requestAt && requestAt <= received && received <= started && started <= ended && ended <= markerAt
    }
}
