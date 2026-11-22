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

/// A solitary Back keeps the measured upper rail slot, even as root tabs appear below it.
@MainActor
func verifyWindowTopBack(in window: UIWindow, controller: UIViewController) throws {
    let safeTop: CGFloat = 192
    let oldTop: CGFloat = 560
    let railBottom: CGFloat = 40
    let surface = NavigationGlassSurfaceView(frame: CGRect(x: 807, y: 0, width: 60, height: 625))
    controller.view.addSubview(surface)
    defer { surface.removeFromSuperview() }
    surface.railAvailableHeight = window.bounds.height
    surface.railRightInset = 12
    surface.railTopInset = oldTop
    surface.railBottomInset = railBottom
    surface.railBackTopInset = safeTop
    surface.layoutMode = "right"
    let back: [String: Any] = ["id": "back", "label": "Back", "accessibilityLabel": "Back", "testID": "navigation-back"]
    surface.actions = [back] as NSArray
    surface.layoutIfNeeded()
    let portal = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? NavigationWindowRailHost }.first)
    portal.layoutIfNeeded()
    let button = try XCTUnwrap(surface.innerActions.arrangedSubviews.compactMap { $0 as? UIButton }.first)
    let frame = button.convert(button.bounds, to: window)
    XCTAssertEqual(frame.minY, safeTop, accuracy: 0.5)
    XCTAssertEqual(frame.maxX, window.bounds.maxX - 12, accuracy: 0.5)
    XCTAssertEqual(frame.height, 48, accuracy: 0.5)
    XCTAssertEqual(frame.width, 48, accuracy: 0.5)
    XCTAssertTrue(window.hitTest(CGPoint(x: frame.midX, y: frame.midY), with: nil) === button)

    let tabs: [[String: Any]] = ["conversation", "overview", "records", "settings"].map { tab in
        ["id": "tab-\(tab)", "label": tab, "accessibilityLabel": tab, "testID": "navigation-tab-\(tab)", "rootTab": true]
    }
    surface.actions = ([back] + tabs) as NSArray
    portal.layoutIfNeeded()
    XCTAssertTrue(surface.innerActions.arrangedSubviews.compactMap { $0 as? UIButton }.first === button)
    XCTAssertEqual(button.convert(button.bounds, to: window).minY, safeTop, accuracy: 0.5)
    XCTAssertEqual(surface.rootBar.convert(surface.rootBar.bounds, to: window).maxY, window.bounds.maxY - railBottom, accuracy: 0.5)
    XCTAssertFalse(window.hitTest(CGPoint(x: frame.midX, y: frame.maxY + 8), with: nil) === button)

    let dock = NavigationGlassSurfaceView(frame: surface.frame)
    controller.view.insertSubview(dock, belowSubview: surface)
    defer { dock.removeFromSuperview() }
    dock.isPageDock = true
    dock.railAvailableHeight = window.bounds.height
    dock.railRightInset = 12
    dock.railTopInset = safeTop + NavigationRootGlassBar.contextualBackGroupHeight
    dock.railBottomInset = window.bounds.height - dock.railTopInset - 60
    dock.layoutMode = "right"
    dock.actions = [
        ["id": "page:save", "label": "Save", "accessibilityLabel": "Save", "testID": "page-save"],
    ] as NSArray
    controller.view.layoutIfNeeded()
    let save = try XCTUnwrap(dock.innerActions.arrangedSubviews.compactMap { $0 as? UIButton }.first)
    let saveFrame = save.convert(save.bounds, to: window)
    XCTAssertEqual(saveFrame.minY, dock.railTopInset + 12, accuracy: 0.5)
    XCTAssertGreaterThanOrEqual(saveFrame.minY - frame.maxY, 4)
    XCTAssertTrue(window.hitTest(CGPoint(x: saveFrame.midX, y: saveFrame.midY), with: nil) === save)
    XCTAssertTrue(window.hitTest(CGPoint(x: frame.midX, y: frame.midY), with: nil) === button)

    // A non-window host must never borrow the portal's safe top.
    surface.actions = [back] as NSArray
    XCTAssertEqual(surface.contextualRailTop(hostHeight: window.bounds.height, mountedToWindow: false), oldTop)
    // Stale opt-in with insufficient space or a different lane cannot pull the group into an unsafe slot.
    XCTAssertEqual(surface.contextualRailTop(hostHeight: 280, mountedToWindow: true), oldTop)
    surface.layoutMode = "left"
    XCTAssertEqual(surface.contextualRailTop(hostHeight: window.bounds.height, mountedToWindow: true), oldTop)
}
