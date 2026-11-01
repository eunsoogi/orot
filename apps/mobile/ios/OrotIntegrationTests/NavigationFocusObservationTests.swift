import CoreFoundation
@testable import Orot
import UIKit
import XCTest

/// Test-only serialization must preserve ambiguity and privacy even when UIKit supplies unusable geometry.
final class NavigationFocusObservationTests: OrotFailFastTestCase {
    @MainActor
    func testNonfiniteCoordinatesRemainExplicitAndJSONSerializable() throws {
        let payload = NavigationGeometryTestObservation.finiteRect(CGRect(x: CGFloat.nan, y: CGFloat.infinity, width: 40, height: 44))
        let data = try JSONSerialization.data(withJSONObject: payload)
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(decoded["x"] is NSNull)
        XCTAssertTrue(decoded["y"] is NSNull)
        XCTAssertEqual(decoded["width"] as? Double, 40)
        XCTAssertEqual(decoded["height"] as? Double, 44)
        let state = NavigationGeometryTestObservation.voiceOverState(running: false, readAtMs: .nan)
        XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: state))
        XCTAssertTrue(state["readAtMs"] is NSNull)
    }

    @MainActor
    func testMissingDuplicateDetachedAndTruncatedCandidatesCannotSelectHome() throws {
        // The separate dock sample must reject the same ambiguity and collection losses.
        let valid = ["navigation-home": 1, "navigation-back": 1, "manual-history-save": 1]
        XCTAssertEqual(NavigationControlGeometryObservation.correlationStatus(windowCount: 1, counts: valid, truncated: false, allValid: true), "available")
        XCTAssertEqual(NavigationControlGeometryObservation.correlationStatus(windowCount: 0, counts: valid, truncated: false, allValid: true), "unavailable")
        XCTAssertEqual(NavigationControlGeometryObservation.correlationStatus(windowCount: 2, counts: valid, truncated: false, allValid: true), "ambiguous")
        XCTAssertEqual(NavigationControlGeometryObservation.correlationStatus(windowCount: 1, counts: ["navigation-home": 1, "navigation-back": 1], truncated: false, allValid: true), "unavailable")
        XCTAssertEqual(NavigationControlGeometryObservation.correlationStatus(windowCount: 1, counts: valid.merging(["manual-history-save": 2], uniquingKeysWith: { _, new in new }), truncated: false, allValid: true), "ambiguous")
        XCTAssertEqual(NavigationControlGeometryObservation.correlationStatus(windowCount: 1, counts: valid, truncated: true, allValid: true), "unavailable")
        XCTAssertEqual(NavigationControlGeometryObservation.correlationStatus(windowCount: 1, counts: valid, truncated: false, allValid: false), "unavailable")
        let window = try makeWindow(), other = try makeWindow(), home = UIButton(), duplicate = UIButton()
        window.addSubview(home)
        window.addSubview(duplicate)
        for (windows, homes, truncated, status) in [
            ([], [home], false, "unavailable"), ([window], [], false, "unavailable"),
            ([window, other], [home], false, "ambiguous"), ([window], [home, duplicate], false, "ambiguous"),
            ([window], [home], true, "unavailable"), ([other], [home], false, "unavailable"),
        ] as [([UIWindow], [UIControl], Bool, String)] {
            let payload = NavigationGeometryTestObservation.focusObservation(windows: windows, homes: homes, navigation: [],
                                                                             truncated: truncated, focused: home)
            { _ in
                XCTFail("An ambiguous or unavailable sample must not assign an identity")
                return "unexpected"
            }
            XCTAssertEqual(payload["status"] as? String, status)
            XCTAssertNil(payload["homeID"])
            XCTAssertNil(payload["windowID"])
            XCTAssertNil(payload["focusedID"])
        }
    }

    @MainActor
    func testFocusIdentityNeverReadsOrExportsFocusedContent() throws {
        let state = NavigationGeometryTestObservation.voiceOverState(running: true, readAtMs: 1000)
        XCTAssertEqual(Set(state.keys), Set(["running", "readAtMs", "timestampUnits"]))
        XCTAssertEqual(state["running"] as? Bool, true)
        XCTAssertEqual(state["readAtMs"] as? Double, 1000)
        let window = try makeWindow()
        let home = UIButton(frame: CGRect(x: 400, y: 200, width: 48, height: 52))
        let known = UIButton(), opaque = PrivateFocusView()
        window.addSubview(home)
        window.addSubview(known)
        window.addSubview(opaque)
        for (focused, role) in [(home, "home"), (known, "known-navigation"), (opaque, "opaque")] as [(UIView, String)] {
            let payload = NavigationGeometryTestObservation.focusObservation(windows: [window], homes: [home], navigation: [home, known],
                                                                             truncated: false, focused: focused)
            { object in
                object === home ? "view-1" : object === window ? "view-2" : "view-3"
            }
            XCTAssertEqual(payload["status"] as? String, "available")
            XCTAssertEqual(payload["focusedRole"] as? String, role)
            XCTAssertEqual(payload["homeID"] as? String, "view-1")
            let json = try String(decoding: JSONSerialization.data(withJSONObject: payload), as: UTF8.self)
            XCTAssertFalse(json.contains("private-health-content"))
            XCTAssertFalse(json.contains("accessibilityLabel"))
            XCTAssertFalse(json.contains("accessibilityValue"))
        }
        try assertDockObserverRejectsOtherWindowDuplicate()
        try assertConversationObservationIsOneShot()
        try assertDateSelectionPhaseIsolation()
    }

    /// Session, owner and phase bind samples; stale and duplicate requests cannot masquerade as a single receipt.
    @MainActor
    private func assertDateSelectionPhaseIsolation() throws {
        let observer = SymptomDateSelectionObservation.shared, session = UUID().uuidString
        let identity: (NSObject) -> String = { _ in "anonymous" }
        _ = observer.cached(session: session, owner: "owner", identity: identity)
        let generation = try XCTUnwrap(observer.generationForTesting)
        observer.receive(session: UUID().uuidString, owner: "owner", generation: generation, phase: "before")
        XCTAssertTrue((observer.cached(session: session, owner: "owner", identity: identity)["samples"] as? [String: Any])?.isEmpty == true)
        observer.receive(session: session, owner: "owner", generation: generation, phase: "before")
        observer.receive(session: session, owner: "owner", generation: generation, phase: "after")
        let samples = try XCTUnwrap(observer.cached(session: session, owner: "owner", identity: identity)["samples"] as? [String: [String: Any]])
        XCTAssertEqual(samples["before"]?["sampleCount"] as? Int, 1)
        XCTAssertEqual(samples["after"]?["sampleCount"] as? Int, 1)
        let again = try XCTUnwrap(observer.cached(session: session, owner: "owner", identity: identity)["samples"] as? [String: [String: Any]])
        XCTAssertEqual(again["after"]?["endedAtMs"] as? Double, samples["after"]?["endedAtMs"] as? Double)
        observer.receive(session: session, owner: "owner", generation: generation, phase: "before")
        let duplicate = try XCTUnwrap(observer.cached(session: session, owner: "owner", identity: identity)["samples"] as? [String: [String: Any]])
        XCTAssertEqual(duplicate["before"]?["status"] as? String, "duplicate")
        observer.invalidate(owner: "owner")
        _ = observer.cached(session: session, owner: "new-owner", identity: identity)
        observer.receive(session: session, owner: "owner", generation: generation, phase: "after")
        XCTAssertTrue((observer.cached(session: session, owner: "new-owner", identity: identity)["samples"] as? [String: Any])?.isEmpty == true)
        observer.invalidate(owner: "new-owner")
        _ = observer.cached(session: session, owner: "pending-owner", identity: identity)
        let pendingGeneration = try XCTUnwrap(observer.generationForTesting)
        observer.receive(session: session, owner: "pending-owner", generation: pendingGeneration, phase: "after")
        XCTAssertTrue((observer.cached(session: session, owner: "replacement", identity: identity)["samples"] as? [String: Any])?.isEmpty == true)
        observer.invalidate(owner: "replacement")
        _ = observer.cached(session: session, owner: "duplicate-owner", identity: identity)
        let duplicateGeneration = try XCTUnwrap(observer.generationForTesting)
        observer.receive(session: session, owner: "duplicate-owner", generation: duplicateGeneration, phase: "after")
        observer.receive(session: session, owner: "duplicate-owner", generation: duplicateGeneration, phase: "after")
        let repeated = try XCTUnwrap(observer.cached(session: session, owner: "duplicate-owner", identity: identity)["samples"] as? [String: [String: Any]])
        XCTAssertEqual(repeated["after"]?["status"] as? String, "duplicate")
        observer.invalidate(owner: "duplicate-owner")
    }

    /// Polling cannot sample; a nonce and its owner bind exactly one notification to one cache.
    @MainActor
    private func assertConversationObservationIsOneShot() throws {
        let trigger = ConversationHitObservationTrigger.shared
        let first = UUID().uuidString, second = UUID().uuidString
        let identity: (NSObject) -> String = { _ in "anonymous" }
        XCTAssertTrue(trigger.cached(session: first, owner: "a", identity: identity).isEmpty)
        XCTAssertTrue(trigger.cached(session: first, owner: "a", identity: identity).isEmpty)
        let oldGeneration = try XCTUnwrap(trigger.generationForTesting)
        trigger.receive(session: second, owner: "a", generation: oldGeneration)
        XCTAssertTrue(trigger.cached(session: first, owner: "a", identity: identity).isEmpty)
        let name = CFNotificationName("com.orot.tests.conversation-hit.\(first)" as CFString)
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
        let received = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            trigger.cached(session: first, owner: "a", identity: identity)["sampleCount"] as? Int == 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [received], timeout: 3), .completed)
        let original = trigger.cached(session: first, owner: "a", identity: identity)
        let originalSample = try XCTUnwrap(original["sample"] as? [String: Any])
        trigger.receive(session: first, owner: "a", generation: oldGeneration)
        let duplicate = trigger.cached(session: first, owner: "a", identity: identity)
        let duplicateSample = try XCTUnwrap(duplicate["sample"] as? [String: Any])
        XCTAssertEqual(duplicate["receivedAtMs"] as? Double, original["receivedAtMs"] as? Double)
        XCTAssertEqual(duplicateSample["startedAtMs"] as? Double, originalSample["startedAtMs"] as? Double)
        XCTAssertEqual(duplicateSample["endedAtMs"] as? Double, originalSample["endedAtMs"] as? Double)
        XCTAssertTrue(trigger.cached(session: first, owner: "b", identity: identity).isEmpty)
        trigger.receive(session: first, owner: "a", generation: oldGeneration)
        trigger.invalidate(owner: "a")
        XCTAssertTrue(trigger.cached(session: first, owner: "b", identity: identity).isEmpty)
        trigger.invalidate(owner: "b")
        trigger.receive(session: first, owner: "b", generation: oldGeneration)
        XCTAssertTrue(trigger.cached(session: second, owner: "c", identity: identity).isEmpty)
        trigger.receive(session: first, owner: "c", generation: oldGeneration)
        XCTAssertTrue(trigger.cached(session: second, owner: "c", identity: identity).isEmpty)
        trigger.invalidate(owner: "c")
        XCTAssertTrue(trigger.cached(session: first, owner: "a", identity: identity).isEmpty)
        trigger.receive(session: first, owner: "a", generation: oldGeneration)
        XCTAssertTrue(trigger.cached(session: first, owner: "a", identity: identity).isEmpty)
        trigger.invalidate(owner: "a")
    }

    /// Exercise real UIKit windows without reading labels or changing the host's original key window permanently.
    @MainActor
    private func assertDockObserverRejectsOtherWindowDuplicate() throws {
        let window = try makeWindow(), other = try makeWindow()
        let previous = window.windowScene?.windows.first(where: \.isKeyWindow)
        defer { other.isHidden = true; window.isHidden = true; previous?.makeKey() }
        let page = UIView(frame: CGRect(x: 0, y: 0, width: 466, height: 678))
        let navigation = UIView(frame: page.frame)
        page.accessibilityIdentifier = "navigation-page-action-toolbar"
        navigation.accessibilityIdentifier = "navigation-toolbar"
        window.addSubview(page)
        window.addSubview(navigation)
        for (id, host) in [("manual-history-save", page), ("navigation-back", navigation), ("navigation-home", navigation)] {
            let button = PrivateDockControl(frame: CGRect(x: 20, y: 20, width: 48, height: 48))
            button.accessibilityIdentifier = id
            host.addSubview(button)
        }
        window.makeKeyAndVisible()
        let sample = NavigationControlGeometryObservation.snapshot { $0 === window ? "key-window" : "anonymous" }
        XCTAssertEqual(sample["status"] as? String, "available")
        let records = try XCTUnwrap(sample["controls"] as? [[String: Any]])
        XCTAssertEqual(records.count, 3)
        XCTAssertTrue(records.allSatisfy { $0["windowID"] as? String == "key-window" && $0["sameWindow"] as? Bool == true })
        XCTAssertFalse(try String(decoding: JSONSerialization.data(withJSONObject: sample), as: UTF8.self).contains("private-health-content"))
        let duplicate = PrivateDockControl(frame: CGRect(x: 20, y: 20, width: 48, height: 48))
        duplicate.accessibilityIdentifier = "manual-history-save"
        other.addSubview(duplicate)
        other.isHidden = false
        let ambiguous = NavigationControlGeometryObservation.snapshot { $0 === window ? "key-window" : "anonymous" }
        let firstSend = UIButton(), duplicateSend = UIButton()
        firstSend.accessibilityIdentifier = "rag-conversation-send"
        duplicateSend.accessibilityIdentifier = "rag-conversation-send"
        window.addSubview(firstSend)
        other.addSubview(duplicateSend)
        let hit = ConversationHitTestObservation.snapshot { $0 === window ? "key-window" : "anonymous" }
        XCTAssertEqual(hit["status"] as? String, "ambiguous")
        XCTAssertEqual(hit["candidateCount"] as? Int, 2)
        XCTAssertEqual(ambiguous["status"] as? String, "ambiguous")
    }

    @MainActor
    private func makeWindow() throws -> UIWindow {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 466, height: 678)
        return window
    }
}

private final class PrivateDockControl: UIButton {
    override var accessibilityLabel: String? {
        get { XCTFail("Dock label must not be read"); return "private-health-content" }
        set {}
    }

    override var accessibilityValue: String? {
        get { XCTFail("Dock value must not be read"); return "private-health-content" }
        set {}
    }
}

/// Any accidental introspection of the opaque focused object fails instead of silently exposing content.
private final class PrivateFocusView: UIView {
    override var accessibilityLabel: String? {
        get { XCTFail("Focused label must not be read"); return "private-health-content" }
        set {}
    }

    override var accessibilityValue: String? {
        get { XCTFail("Focused value must not be read"); return "private-health-content" }
        set {}
    }

    override var accessibilityIdentifier: String? {
        get { XCTFail("Focused identifier must not be read"); return "private-health-content" }
        set {}
    }
}
