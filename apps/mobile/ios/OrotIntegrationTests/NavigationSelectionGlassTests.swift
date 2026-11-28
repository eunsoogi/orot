@testable import Orot
import UIKit
import XCTest

final class NavigationSelectionGlassTests: OrotFailFastTestCase {
    @MainActor
    func testMaterialDropletSettlesAndReplacesInterruptedTransitions() async throws {
        try await verifyRouteReplacementInWindow()
        let indicator = NavigationSelectionGlass()
        if #available(iOS 26.0, *), !UIAccessibility.isReduceTransparencyEnabled {
            let glass = try XCTUnwrap(indicator.effect as? UIGlassEffect)
            XCTAssertNil(glass.tintColor, "The selection material must retain the system neutral glass appearance.")
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

    @MainActor
    func testSectionSelectionMovesTheSameMaterialInBothHorizontalDirections() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIViewController()
        window.isHidden = false
        defer { window.isHidden = true }
        let view = SectionSelectionGlassView()
        view.frame = CGRect(x: 0, y: 120, width: 390, height: 50)
        window.rootViewController?.view.addSubview(view)
        let material = try XCTUnwrap(view.subviews.first as? UIVisualEffectView)
        let first = CGRect(x: 3, y: 3, width: 96, height: 44)
        let second = CGRect(x: 99, y: 3, width: 132, height: 44)
        func target(_ to: CGRect, from: CGRect? = nil) -> NSDictionary {
            func fields(_ rect: CGRect) -> [String: Any] {
                ["x": Double(rect.minX), "y": Double(rect.minY),
                 "width": Double(rect.width), "height": Double(rect.height)]
            }
            var value = fields(to)
            value["animated"] = from != nil
            if let from {
                value["origin"] = fields(from)
            }
            return value as NSDictionary
        }
        view.selectionTarget = target(first)
        XCTAssertEqual(material.frame, first)
        for (origin, destination) in [(first, second), (second, first)] {
            view.selectionTarget = target(destination, from: origin)
            if UIAccessibility.isReduceMotionEnabled {
                XCTAssertEqual(material.frame, destination)
                continue
            }
            XCTAssertEqual(material.frame, origin, "The visible material must start on the previous tab.")
            let deadline = Date().addingTimeInterval(1.5)
            let xRange = min(origin.minX, destination.minX) ..< max(origin.minX, destination.minX)
            var sawIntermediateFrame = false
            while Date() < deadline, material.frame != destination {
                try await Task.sleep(for: .milliseconds(8))
                let frame = material.frame
                if xRange.contains(frame.minX), frame.minX != xRange.lowerBound {
                    sawIntermediateFrame = true
                    XCTAssertGreaterThan(frame.width, 96)
                    XCTAssertLessThan(frame.width, 132)
                    // A repeated Fabric prop must not send the visual material
                    // back to its start while it is between two tabs.
                    view.selectionTarget = target(destination, from: origin)
                    XCTAssertEqual(material.frame, frame)
                }
            }
            XCTAssertTrue(sawIntermediateFrame)
            XCTAssertEqual(material.frame, destination)
            XCTAssertTrue(view.subviews.first === material)
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
