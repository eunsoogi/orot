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
    XCTAssertEqual(surface.visibleBackPlacement(from: portal), "pinned")
    button.transform = CGAffineTransform(translationX: 0, y: 5)
    XCTAssertEqual(surface.visibleBackPlacement(from: portal), "pinned-frame-mismatch")
    button.transform = .identity
    surface.railBackTopInset = -1
    portal.layoutIfNeeded()
    XCTAssertEqual(surface.visibleBackPlacement(from: portal), "missing-top")
    surface.railBackTopInset = safeTop
    portal.layoutIfNeeded()

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

    // The exact same Back commits to a real local surface and can recover to the portal.
    surface.layoutMode = "bottom"
    surface.frame = CGRect(x: 0, y: window.bounds.height - 60, width: window.bounds.width, height: 60)
    surface.layoutIfNeeded()
    XCTAssertEqual(surface.visibleBackPlacement(from: surface), "bottom-layout")
    XCTAssertNil(surface.visibleBackPlacement(from: portal))
    surface.isHidden = true
    XCTAssertNil(surface.visibleBackPlacement(from: surface))
    surface.isHidden = false
    surface.frame = CGRect(x: controller.view.bounds.width - 60, y: 0, width: 60, height: controller.view.bounds.height)
    surface.railTopInset = safeTop
    surface.layoutMode = "right"
    let fullFrame = controller.view.frame
    controller.view.frame.size.width = fullFrame.width - 100
    surface.setNeedsLayout()
    surface.layoutIfNeeded()
    XCTAssertEqual(surface.visibleBackPlacement(from: surface), "local-host")
    XCTAssertNil(surface.visibleBackPlacement(from: portal))
    controller.view.frame = fullFrame
    surface.setNeedsLayout()
    surface.layoutIfNeeded()
    portal.layoutIfNeeded()
    XCTAssertEqual(surface.visibleBackPlacement(from: portal), "pinned")
}

/// Compare the actual constraints after warm native resizing with the cold safe-top policy.
/// Retain the portal and action, and do not refresh the bridge properties during resize.
@MainActor
func verifyWarmWindowBackAfterPortalResize(in window: UIWindow, controller: UIViewController) throws {
    let originalFrame = window.frame
    let safeTop: CGFloat = 192
    let legacyTop: CGFloat = 166
    window.frame.size.height = 260
    controller.view.frame = window.bounds
    let surface = NavigationGlassSurfaceView(frame: CGRect(x: window.bounds.maxX - 60, y: 0, width: 60, height: 260))
    controller.view.addSubview(surface)
    defer {
        surface.removeFromSuperview()
        window.frame = originalFrame
        controller.view.frame = window.bounds
    }

    surface.railAvailableHeight = originalFrame.height
    surface.railRightInset = 12
    surface.railTopInset = legacyTop
    surface.railBottomInset = 34
    surface.railBackTopInset = safeTop
    surface.layoutMode = "right"
    surface.actions = [
        ["id": "back", "label": "Back", "accessibilityLabel": "Back", "testID": "navigation-back"],
    ] as NSArray
    surface.layoutIfNeeded()
    let portal = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? NavigationWindowRailHost }.first)
    portal.layoutIfNeeded()
    let button = try XCTUnwrap(surface.innerActions.arrangedSubviews.compactMap { $0 as? UIButton }.first)
    XCTAssertEqual(portal.bounds.height, 260, accuracy: 0.5)
    XCTAssertEqual(button.convert(button.bounds, to: window).minY, legacyTop, accuracy: 0.5)
    XCTAssertEqual(surface.visibleBackPlacement(from: portal), "insufficient-fit")

    // The shared overlay revision is the only bridge update; action, full height and safe top stay fixed.
    window.frame = originalFrame
    controller.view.frame = window.bounds
    surface.geometryLayoutRevision = "[0,0,\(originalFrame.width),\(originalFrame.height)]"
    surface.layoutIfNeeded()
    portal.layoutIfNeeded()
    XCTAssertTrue(surface.innerActions.superview === portal)
    XCTAssertTrue(surface.innerActions.arrangedSubviews.first === button)
    XCTAssertEqual(portal.bounds.height, originalFrame.height, accuracy: 0.5)
    XCTAssertEqual(surface.contextualRailTop(hostHeight: portal.bounds.height, mountedToWindow: true), safeTop)

    let expanded = button.convert(button.bounds, to: window)
    XCTAssertEqual(expanded.minY, safeTop, accuracy: 0.5)
    XCTAssertEqual(expanded.size.width, 48, accuracy: 0.5)
    XCTAssertEqual(expanded.size.height, 48, accuracy: 0.5)
    XCTAssertTrue(window.hitTest(CGPoint(x: expanded.midX, y: expanded.midY), with: nil) === button)

    // Simulate a stale portal frame after a warm host update. Publishing that
    // frame alone cannot repair it; the mounted owner must recompute admission.
    portal.frame.size.height = 260
    portal.layoutIfNeeded()
    XCTAssertEqual(portal.bounds.height, 260, accuracy: 0.5)
    surface.geometryLayoutRevision = "[0,1,\(originalFrame.width),\(originalFrame.height)]"
    surface.layoutIfNeeded()
    portal.layoutIfNeeded()
    XCTAssertEqual(portal.bounds.height, originalFrame.height, accuracy: 0.5)
    XCTAssertEqual(button.convert(button.bounds, to: window).minY, safeTop, accuracy: 0.5)
}

@MainActor
func verifyBottomIconPageActionShape() throws {
    for width: CGFloat in [320, 680] {
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 0, y: 0, width: width, height: 64))
        surface.isPageDock = true
        surface.bottomHeight = 64
        let first: [String: Any] = [
            "id": "page:edit", "label": "Edit", "testID": "page-edit",
            "accessibilityLabel": "Edit the current record", "primary": true,
            "systemImageName": "pencil", "layoutWidth": 88,
        ]
        let overflow: [String: Any] = [
            "id": "page:overflow", "label": "More", "testID": "page-more",
            "accessibilityLabel": "More actions for the current record", "primary": true,
            "systemImageName": "ellipsis", "layoutWidth": 120,
        ]
        for actions in [[first], [first, overflow]] {
            surface.actions = actions as NSArray
            surface.layoutIfNeeded()
            let group = try XCTUnwrap(surface.subviews.compactMap { $0 as? UIStackView }.first)
            let buttons = group.arrangedSubviews.compactMap { $0 as? UIButton }
            XCTAssertEqual(buttons.count, actions.count)
            for (button, action) in zip(buttons, actions) {
                XCTAssertEqual(button.bounds.width, 48, accuracy: 0.5)
                XCTAssertEqual(button.bounds.height, 48, accuracy: 0.5)
                XCTAssertEqual(button.accessibilityLabel, action["accessibilityLabel"] as? String)
                XCTAssertEqual(button.configuration?.cornerStyle, .capsule)
            }
        }
    }
}
