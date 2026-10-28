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
    }

    @MainActor
    private func makeWindow() throws -> UIWindow {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 466, height: 678)
        return window
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
