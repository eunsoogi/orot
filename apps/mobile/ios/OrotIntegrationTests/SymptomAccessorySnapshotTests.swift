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
