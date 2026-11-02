@testable import Orot
import UIKit
import XCTest

/// Models the keyboard-contracted viewport and bottom overlay without changing action identity.
/// Deterministic UIKit geometry is a regression fixture, not actual keyboard acceptance.
final class NavigationViewportFrameIntegrationTests: OrotFailFastTestCase {
    @MainActor
    func testBottomActionMetricsGrowWithAccessibilityText() throws {
        let action = try XCTUnwrap(NavigationActionDescriptor([
            "id": "page:save", "label": "Save", "testID": "save", "accessibilityLabel": "Save",
            "systemImageName": "checkmark", "showsTitleWithSystemImage": true, "titleBelowImage": true,
        ]))
        let standard = UITraitCollection(preferredContentSizeCategory: .large)
        let accessible = UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge)
        XCTAssertGreaterThan(NavigationTextMetrics.width(for: action, traits: accessible), NavigationTextMetrics.width(for: action, traits: standard))
        XCTAssertGreaterThan(NavigationTextMetrics.height(for: action, traits: accessible), NavigationTextMetrics.height(for: action, traits: standard))
    }

    @MainActor
    func testBackTitleIsVisibleBelowIconOnBottomAndHiddenOnRail() throws {
        let action = try XCTUnwrap(NavigationActionDescriptor([
            "id": "back", "label": "Back", "testID": "navigation-back", "accessibilityLabel": "Back",
        ]))
        let button = NavigationGlassButton.make(for: action, onAction: { _ in })
        let content = try XCTUnwrap(button.subviews.compactMap { $0 as? UIStackView }.first)
        let icon = try XCTUnwrap(content.arrangedSubviews.first as? UIImageView)
        let label = try XCTUnwrap(content.arrangedSubviews.last as? UILabel)
        XCTAssertEqual(content.axis, .vertical)
        XCTAssertNotNil(icon.image)
        XCTAssertEqual(label.text, "Back")
        XCTAssertFalse(label.isHidden)
        NavigationGlassButton.setUsesRightRail(true, for: action, button: button)
        XCTAssertTrue(label.isHidden)
        XCTAssertEqual(button.accessibilityLabel, "Back")
        NavigationGlassButton.setUsesRightRail(false, for: action, button: button)
        XCTAssertFalse(label.isHidden)
    }

    @MainActor
    func testContractedViewportRefreshesBottomAnchoredNavigationWindowFrame() throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive })
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        let controller = UIViewController()
        window.rootViewController = controller
        controller.view.frame = window.bounds
        window.isHidden = false
        defer { window.isHidden = true }

        let sensor = NavigationGeometryView(frame: controller.view.bounds)
        controller.view.addSubview(sensor)
        var published: [AnyHashable: Any]?
        sensor.onGeometryChange = { published = $0 }
        let ancestor = UIView(frame: controller.view.bounds)
        controller.view.addSubview(ancestor)
        let overlay = UIView()
        overlay.translatesAutoresizingMaskIntoConstraints = false
        ancestor.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: ancestor.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: ancestor.trailingAnchor),
            overlay.bottomAnchor.constraint(equalTo: ancestor.bottomAnchor),
            overlay.heightAnchor.constraint(equalToConstant: 48),
        ])
        ancestor.layoutIfNeeded()
        let surface = NavigationGlassSurfaceView(frame: overlay.bounds)
        overlay.addSubview(surface)
        surface.actions = [
            ["id": "back", "label": "Back", "accessibilityLabel": "Back", "testID": "navigation-back"],
            ["id": "home", "label": "Home", "accessibilityLabel": "Home", "testID": "navigation-home"],
        ] as NSArray
        controller.view.layoutIfNeeded()
        let controls = try XCTUnwrap(surface.subviews.compactMap { $0 as? UIStackView }.first)
        let initial = controls.convert(controls.bounds, to: window)
        let initialPayload = try XCTUnwrap(published?["navigationFrame"] as? [String: Double])
        XCTAssertEqual(try XCTUnwrap(initialPayload["y"]), Double(initial.minY), accuracy: 0.5)
        let localBounds = controls.bounds

        // Match the observed KAV viewport contraction (874→546), then complete its layout.
        // The anchored overlay moves; the surface and controls are never forced dirty by the test.
        ancestor.frame.size.height = 546
        ancestor.setNeedsLayout()
        ancestor.layoutIfNeeded()
        let current = controls.convert(controls.bounds, to: window)
        XCTAssertEqual(controls.bounds, localBounds)
        XCTAssertEqual(current.minY, initial.minY - 328, accuracy: 0.5)
        let latest = try XCTUnwrap(published?["navigationFrame"] as? [String: Double])
        let diagnostic: [String: Any] = ["reported": latest, "actual": [
            "x": current.minX, "y": current.minY, "width": current.width, "height": current.height,
        ]]
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: diagnostic), uniformTypeIdentifier: "public.json")
        attachment.name = "contracted-viewport-navigation-window-frames"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertEqual(try XCTUnwrap(latest["x"]), Double(current.minX), accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(latest["y"]), Double(current.minY), accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(latest["width"]), Double(current.width), accuracy: 0.5)
        XCTAssertEqual(try XCTUnwrap(latest["height"]), Double(current.height), accuracy: 0.5)
    }
}
