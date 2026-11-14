@testable import Orot
import UIKit
import XCTest

final class NavigationSelectionGlassTests: OrotFailFastTestCase {
    @MainActor
    func testMaterialDropletSettlesAndReplacesInterruptedTransitions() throws {
        let indicator = NavigationSelectionGlass()
        if #available(iOS 26.0, *), !UIAccessibility.isReduceTransparencyEnabled {
            XCTAssertTrue(indicator.effect is UIGlassEffect)
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
            let bounds = try XCTUnwrap(group.animations?.compactMap { $0 as? CAKeyframeAnimation }.first { $0.keyPath == "bounds" } as? CAKeyframeAnimation)
            let middle = try XCTUnwrap(bounds.values?[1] as? NSValue).cgRectValue
            XCTAssertGreaterThan(middle.height, second.height)
            XCTAssertLessThan(middle.width, second.width)
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
            let bounds = try XCTUnwrap(group.animations?.compactMap { $0 as? CAKeyframeAnimation }.first { $0.keyPath == "bounds" } as? CAKeyframeAnimation)
            let middle = try XCTUnwrap(bounds.values?[1] as? NSValue).cgRectValue
            XCTAssertGreaterThan(middle.width, first.width)
            XCTAssertLessThan(middle.height, first.height)
        }
    }
}
