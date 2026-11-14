@testable import Orot
import UIKit
import XCTest

final class NavigationSelectionGlassTests: OrotFailFastTestCase {
    @MainActor
    func testMaterialDropletSettlesAndReplacesInterruptedTransitions() async throws {
        try await verifyRouteReplacementInWindow()
        let indicator = NavigationSelectionGlass()
        if #available(iOS 26.0, *), !UIAccessibility.isReduceTransparencyEnabled {
            XCTAssertTrue(indicator.effect is UIGlassEffect)
        }
        if UIAccessibility.isReduceTransparencyEnabled {
            XCTAssertNil(indicator.effect)
            XCTAssertEqual(indicator.backgroundColor, .systemGray4)
        }
        XCTAssertFalse(indicator.isUserInteractionEnabled)
        let first = CGRect(x: 2, y: 2, width: 44, height: 44)
        let second = first.offsetBy(dx: 0, dy: 56)
        let third = first.offsetBy(dx: 0, dy: 112)
        indicator.move(to: first, animated: false, vertical: true)
        XCTAssertEqual(indicator.frame, first)
        XCTAssertNil(indicator.layer.animation(forKey: "navigation-droplet"))
        indicator.move(to: second, animated: true, vertical: true)
        if !UIAccessibility.isReduceMotionEnabled {
            let group = try XCTUnwrap(indicator.layer.animation(forKey: "navigation-droplet") as? CAAnimationGroup)
            let bounds = try XCTUnwrap(group.animations?.compactMap { $0 as? CAKeyframeAnimation }.first { $0.keyPath == "transform" })
            XCTAssertEqual(bounds.duration, group.duration)
            let middle = try XCTUnwrap(bounds.values?[1] as? NSValue).caTransform3DValue
            XCTAssertGreaterThan(middle.m22, 1)
            XCTAssertLessThan(middle.m11, 1)
        }
        if UIAccessibility.isReduceMotionEnabled {
            XCTAssertNil(indicator.layer.animation(forKey: "navigation-droplet"))
        }
        indicator.move(to: third, animated: true, vertical: true)
        XCTAssertEqual(indicator.targetFrame, third)
        XCTAssertEqual(indicator.frame, third)
        XCTAssertLessThanOrEqual(indicator.layer.animationKeys()?.count ?? 0, 1)
        // Nonanimated layout or Reduce Motion settlement must remove the old trajectory.
        indicator.move(to: first, animated: false, vertical: false)
        XCTAssertNil(indicator.layer.animation(forKey: "navigation-droplet"))
        XCTAssertEqual(indicator.frame, first)
        XCTAssertEqual(indicator.layer.cornerRadius, 22)
        indicator.move(to: first.offsetBy(dx: 60, dy: 0), animated: true, vertical: false)
        if !UIAccessibility.isReduceMotionEnabled {
            let group = try XCTUnwrap(indicator.layer.animation(forKey: "navigation-droplet") as? CAAnimationGroup)
            let bounds = try XCTUnwrap(group.animations?.compactMap { $0 as? CAKeyframeAnimation }.first { $0.keyPath == "transform" })
            XCTAssertEqual(bounds.duration, group.duration)
            let middle = try XCTUnwrap(bounds.values?[1] as? NSValue).caTransform3DValue
            XCTAssertGreaterThan(middle.m11, 1)
            XCTAssertLessThan(middle.m22, 1)
        }
    }

    /// Exercise the real bar lifecycle, because route replacement creates a new native view.
    @MainActor
    private func verifyRouteReplacementInWindow() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIViewController()
        window.isHidden = false
        defer { window.isHidden = true }
        let first = bar(selected: 0)
        window.rootViewController?.view.addSubview(first)
        first.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(30))
        first.removeFromSuperview()
        let replacement = bar(selected: 2)
        window.rootViewController?.view.addSubview(replacement)
        replacement.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(30))
        let selection = try XCTUnwrap(replacement.contentView.subviews.compactMap { $0 as? NavigationSelectionGlass }.first)
        if UIAccessibility.isReduceMotionEnabled {
            XCTAssertNil(selection.layer.animation(forKey: "navigation-droplet"))
        } else {
            XCTAssertNotNil(selection.layer.animation(forKey: "navigation-droplet"))
            selection.move(to: selection.targetFrame, animated: false, vertical: false)
            XCTAssertNotNil(selection.layer.animation(forKey: "navigation-droplet"))
        }
        XCTAssertEqual(NavigationSelectionHistory.last.object(forKey: window)?.id, "tab-2")
        let otherWindow = UIWindow(windowScene: scene)
        otherWindow.rootViewController = UIViewController()
        otherWindow.isHidden = false
        defer { otherWindow.isHidden = true }
        let independent = bar(selected: 1)
        otherWindow.rootViewController?.view.addSubview(independent)
        independent.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(30))
        let independentSelection = try XCTUnwrap(independent.contentView.subviews.compactMap { $0 as? NavigationSelectionGlass }.first)
        XCTAssertNil(independentSelection.layer.animation(forKey: "navigation-droplet"))
        XCTAssertEqual(NavigationSelectionHistory.last.object(forKey: window)?.id, "tab-2")
    }

    @MainActor
    private func bar(selected: Int) -> NavigationRootGlassBar {
        let bar = NavigationRootGlassBar()
        bar.frame = CGRect(x: 20, y: 200, width: 350, height: 60)
        let actions = (0 ..< 5).compactMap { index in
            NavigationActionDescriptor(["id": "tab-\(index)", "label": "Tab \(index)",
                                        "accessibilityLabel": "Tab \(index)", "testID": "tab-\(index)",
                                        "rootTab": true, "selected": selected == index])
        }
        bar.render(actions, animated: false, onAction: { _ in })
        return bar
    }
}
