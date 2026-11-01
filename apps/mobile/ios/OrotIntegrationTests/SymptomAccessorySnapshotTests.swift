@testable import Orot
import UIKit
import XCTest

/// Fixtures implement RN's public getters, while the observer reads real UIKit responder and accessory objects.
private final class SnapshotDescriptionView: UITextView {
    @objc var inputAccessoryViewID: String? = "symptom-form-description"
}

private final class SnapshotAccessoryProvider: UIView {
    @objc var nativeId: String? = "symptom-form-description"
    let content = UIView(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
    override var inputAccessoryView: UIView? {
        content
    }
}

final class SymptomAccessorySnapshotTests: OrotFailFastTestCase {
    @MainActor
    private func assertDockCaptureRequiresCompleteHostsAndIncludesDisabledUnknownControls() throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let priorKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 640)
        window.makeKeyAndVisible()
        defer { window.isHidden = true; priorKeyWindow?.makeKey() }
        let page = UIView(frame: CGRect(x: 0, y: 400, width: 320, height: 60))
        let navigation = UIView(frame: CGRect(x: 0, y: 500, width: 320, height: 60))
        page.accessibilityIdentifier = "navigation-page-action-toolbar"
        navigation.accessibilityIdentifier = "navigation-toolbar"
        window.addSubview(page)
        window.addSubview(navigation)
        let unknown = UIButton(frame: CGRect(x: 10, y: 5, width: 80, height: 40))
        unknown.isEnabled = false
        let home = UIButton(frame: CGRect(x: 10, y: 5, width: 80, height: 40))
        home.accessibilityIdentifier = "navigation-home"
        page.addSubview(unknown)
        navigation.addSubview(home)
        let views: [UIView] = [page, navigation, unknown, home]
        func capture(_ values: [UIView], truncated: Bool = false) -> [String: Any] {
            SymptomDockControlObservation.capture(views: values, window: window, truncated: truncated) { String(describing: ObjectIdentifier($0)) }
        }
        let result = capture(views)
        XCTAssertEqual(result["complete"] as? Bool, true)
        XCTAssertEqual((result["controls"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual(capture(views, truncated: true)["complete"] as? Bool, false)
        XCTAssertEqual(capture([page, unknown])["complete"] as? Bool, false)
        let duplicate = UIView(frame: page.frame)
        duplicate.accessibilityIdentifier = "navigation-page-action-toolbar"
        window.addSubview(duplicate)
        XCTAssertEqual(capture(views + [duplicate])["complete"] as? Bool, false)
        let anotherHome = UIButton(frame: CGRect(x: 100, y: 5, width: 80, height: 40))
        anotherHome.accessibilityIdentifier = "navigation-home"
        navigation.addSubview(anotherHome)
        XCTAssertEqual(capture(views + [anotherHome])["complete"] as? Bool, false)
    }

    @MainActor
    func testAttachmentPairsObjectsInsteadOfRepeatedNativeIDs() throws {
        let root = UIView()
        let input = descriptionView()
        let attached = SnapshotAccessoryProvider()
        let duplicate = SnapshotAccessoryProvider()
        let views: [UIView] = [input, attached, duplicate]
        views.forEach(root.addSubview)
        input.inputAccessoryView = attached.content
        let value = snapshot([root])
        let report = try XCTUnwrap((value["inputs"] as? [[String: Any]])?.first)
        let matches = try XCTUnwrap(report["matchingProviders"] as? [[String: Any]])
        XCTAssertEqual(matches.count, 2)
        let actualID = try XCTUnwrap((report["actualAccessory"] as? [String: Any])?["identity"] as? String)
        let sameObject = try XCTUnwrap(matches.first { ($0["getterAccessory"] as? [String: Any])?["identity"] as? String == actualID })
        let otherObject = try XCTUnwrap(matches.first { ($0["getterAccessory"] as? [String: Any])?["identity"] as? String != actualID })
        XCTAssertEqual(sameObject["sharesActualAccessory"] as? Bool, true)
        XCTAssertEqual(otherObject["sharesActualAccessory"] as? Bool, false, "A duplicate nativeID must not imply attachment to the focused input's actual accessory object")
    }

    @MainActor
    func testMissingAndDetachedTargetsRemainExplicit() throws {
        try assertDockCaptureRequiresCompleteHostsAndIncludesDisabledUnknownControls()
        let root = UIView()
        let provider = SnapshotAccessoryProvider()
        root.addSubview(provider)
        let missing = snapshot([root])
        XCTAssertEqual(missing["inputCount"] as? Int, 0)
        XCTAssertEqual(missing["providerCount"] as? Int, 1)
        let input = descriptionView()
        root.addSubview(input)
        let detached = snapshot([root])
        let report = try XCTUnwrap((detached["inputs"] as? [[String: Any]])?.first)
        XCTAssertEqual((report["input"] as? [String: Any])?["hasWindow"] as? Bool, false)
        XCTAssertTrue(report["actualAccessory"] is NSNull)
        let match = try XCTUnwrap((report["matchingProviders"] as? [[String: Any]])?.first)
        XCTAssertTrue(match["sharesActualAccessory"] is NSNull, "No actual accessory makes an identity comparison unavailable")
        provider.removeFromSuperview()
        XCTAssertEqual(snapshot([root])["providerCount"] as? Int, 0)
    }

    @MainActor
    func testSnapshotPreservesFocusAndOmitsTextAndHierarchy() throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let priorKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 640)
        let controller = UIViewController()
        window.rootViewController = controller
        let input = descriptionView()
        input.frame = CGRect(x: 20, y: 20, width: 200, height: 80)
        input.text = "synthetic-private-input-content"
        input.accessibilityLabel = "synthetic-private-AX-label"
        controller.view.addSubview(input)
        window.makeKeyAndVisible()
        // Focus is a fixture precondition; the observation itself must neither acquire nor discard it.
        XCTAssertTrue(input.becomeFirstResponder())
        defer {
            input.resignFirstResponder()
            window.isHidden = true
            priorKeyWindow?.makeKey()
        }
        let value = snapshot([window])
        XCTAssertTrue(input.isFirstResponder)
        XCTAssertEqual(input.text, "synthetic-private-input-content")
        let report = try XCTUnwrap((value["inputs"] as? [[String: Any]])?.first)
        XCTAssertEqual(report["isFirstResponder"] as? Bool, true)
        let encoded = try String(decoding: JSONSerialization.data(withJSONObject: value), as: UTF8.self)
        for forbidden in ["synthetic-private-input-content", "synthetic-private-AX-label", "subviews", "children"] {
            XCTAssertFalse(encoded.contains(forbidden))
        }
        try assertDeclaredControlGeometry(window: window, controller: controller, input: input)
    }

    /// Missing, duplicated, or clipped targets remain distinct and never expose the fixture's private strings.
    @MainActor
    private func assertDeclaredControlGeometry(window: UIWindow, controller: UIViewController, input: UITextView) throws {
        let scroll = UIScrollView(frame: controller.view.bounds)
        controller.view.addSubview(scroll)
        scroll.addSubview(input)
        let date = UITextField(frame: CGRect(x: 20, y: 120, width: 120, height: 40))
        date.accessibilityIdentifier = "symptom-onset-date"
        date.text = "synthetic-private-date"
        let status = UIButton(frame: CGRect(x: 20, y: 180, width: 120, height: 40))
        status.accessibilityIdentifier = "symptom-status-active"
        status.accessibilityLabel = "synthetic-private-status-label"
        let error = UILabel(frame: CGRect(x: 20, y: 240, width: 200, height: 40))
        error.accessibilityIdentifier = "symptom-form-error"
        error.text = "synthetic-private-error"
        scroll.addSubview(date)
        scroll.addSubview(status)
        scroll.addSubview(error)
        XCTAssertTrue(date.becomeFirstResponder())
        let views: [UIView] = [window, controller.view, scroll, input, date, status, error]
        let identity: (NSObject) -> String = { object in object === window ? "window" : object === scroll ? "scroll" : "control" }
        let sample = SymptomControlGeometryObservation.capture(input: input, views: views, window: window, truncated: false, identity: identity)
        XCTAssertEqual(sample["focusRole"] as? String, "symptom-onset-date")
        let controls = try XCTUnwrap(sample["controls"] as? [[String: Any]])
        let target = try XCTUnwrap(controls.first { $0["role"] as? String == "symptom-status-active" })
        XCTAssertEqual(target["count"] as? Int, 1)
        let candidate = try XCTUnwrap((target["candidates"] as? [[String: Any]])?.first)
        XCTAssertEqual(candidate["sameSelectedScroll"] as? Bool, true)
        let errorTarget = try XCTUnwrap(controls.first { $0["role"] as? String == "symptom-form-error" })
        XCTAssertEqual(errorTarget["count"] as? Int, 1)
        XCTAssertEqual(((errorTarget["candidates"] as? [[String: Any]])?.first)?["sameSelectedScroll"] as? Bool, true)
        let encoded = try String(decoding: JSONSerialization.data(withJSONObject: sample), as: UTF8.self)
        XCTAssertFalse(encoded.contains("synthetic-private-date"))
        XCTAssertFalse(encoded.contains("synthetic-private-status-label"))
        XCTAssertFalse(encoded.contains("synthetic-private-error"))
        let duplicate = UIButton()
        duplicate.accessibilityIdentifier = "symptom-status-active"
        let other = try UIWindow(windowScene: XCTUnwrap(window.windowScene))
        other.addSubview(duplicate)
        defer { other.isHidden = true }
        let ambiguous = SymptomControlGeometryObservation.capture(input: input, views: views + [duplicate], window: window, truncated: false, identity: identity)
        let repeated = try XCTUnwrap((ambiguous["controls"] as? [[String: Any]])?.first { $0["role"] as? String == "symptom-status-active" })
        XCTAssertEqual(repeated["count"] as? Int, 2)
        let candidates = try XCTUnwrap(repeated["candidates"] as? [[String: Any]])
        XCTAssertTrue(candidates[1]["frame"] is NSNull)
        XCTAssertEqual((candidates[1]["centerHit"] as? [String: Any])?["status"] as? String, "unavailable")
        let truncated = SymptomControlGeometryObservation.capture(input: input, views: views, window: window, truncated: true, identity: identity)
        XCTAssertEqual(truncated["focusRole"] as? String, "unknown")
        XCTAssertEqual(truncated["selectionComplete"] as? Bool, false)
        status.layer.mask = CALayer()
        let masked = SymptomControlGeometryObservation.capture(input: input, views: views, window: window, truncated: false, identity: identity)
        let maskedTarget = try XCTUnwrap((masked["controls"] as? [[String: Any]])?.first { $0["role"] as? String == "symptom-status-active" })
        XCTAssertEqual(((maskedTarget["candidates"] as? [[String: Any]])?.first)?["clippingComplete"] as? Bool, false)
        status.layer.mask = nil
        status.frame.origin.y = 2000
        scroll.clipsToBounds = true
        let offscreen = SymptomControlGeometryObservation.capture(input: input, views: views, window: window, truncated: false, identity: identity)
        let offscreenTarget = try XCTUnwrap((offscreen["controls"] as? [[String: Any]])?.first { $0["role"] as? String == "symptom-status-active" })
        XCTAssertEqual(((offscreenTarget["candidates"] as? [[String: Any]])?.first)?["clippedFrameEmpty"] as? Bool, true)
        var container: UIView = scroll
        for _ in 0 ..< 65 {
            let child = UIView()
            container.addSubview(child)
            container = child
        }
        container.addSubview(input)
        let deep = SymptomControlGeometryObservation.capture(input: input, views: views, window: window, truncated: false, identity: identity)
        XCTAssertEqual(deep["selectionComplete"] as? Bool, false)
        XCTAssertNil(deep["scroll"])
    }

    @MainActor
    private func descriptionView() -> SnapshotDescriptionView {
        let input = SnapshotDescriptionView()
        input.accessibilityIdentifier = "symptom-description"
        return input
    }

    @MainActor
    private func snapshot(_ roots: [UIView]) -> [String: Any] {
        var ids: [ObjectIdentifier: String] = [:]
        return SymptomAccessorySnapshot.capture(roots: roots) { object in
            let key = ObjectIdentifier(object)
            if let existing = ids[key] {
                return existing
            }
            let value = "fixture-object-\(ids.count + 1)"
            ids[key] = value
            return value
        }
    }
}
