@testable import Orot
import UIKit
import XCTest

/// Exercises the page-only native dock with the segment allocated by the JS rail policy.
@MainActor
func verifyTopAlignedPageDock(in window: UIWindow, controller: UIViewController) throws {
    for count in [1, 2] {
        let top: CGFloat = 192
        let step: CGFloat = 60 // 48pt target plus the existing 12pt stack interval.
        let surface = NavigationGlassSurfaceView(frame: controller.view.bounds)
        controller.view.addSubview(surface)
        defer { surface.removeFromSuperview() }
        surface.railAvailableHeight = window.bounds.height
        surface.layoutMode = "right"
        surface.railRightInset = 12
        surface.railTopInset = top
        surface.railBottomInset = window.bounds.height - top - CGFloat(count) * step
        surface.actions = (0 ..< count).map { index in
            ["id": "page-\(index)", "label": "Synthetic action \(index)",
             "accessibilityLabel": "Synthetic action \(index)", "testID": "page-\(index)"]
        } as NSArray
        surface.layoutIfNeeded()
        let portal = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? NavigationWindowRailHost }.first)
        portal.layoutIfNeeded()
        let stack = try XCTUnwrap(portal.subviews.compactMap { $0 as? UIStackView }.first)
        stack.layoutIfNeeded()
        let buttons = stack.arrangedSubviews.compactMap { $0 as? UIButton }
        XCTAssertEqual(buttons.count, count)
        for (index, button) in buttons.enumerated() {
            let frame = button.convert(button.bounds, to: window)
            XCTAssertEqual(frame.minY, top + 12 + CGFloat(index) * step, accuracy: 0.5)
            XCTAssertEqual(frame.width, 48, accuracy: 0.5)
            XCTAssertEqual(frame.height, 48, accuracy: 0.5)
            XCTAssertEqual(frame.maxX, window.bounds.width - 12, accuracy: 0.5)
            XCTAssertTrue(window.bounds.contains(frame))
            XCTAssertTrue(window.hitTest(CGPoint(x: frame.midX, y: frame.midY), with: nil) === button)
        }
    }
}
