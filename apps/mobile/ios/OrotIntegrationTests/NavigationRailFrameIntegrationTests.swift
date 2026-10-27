@testable import Orot
import UIKit
import XCTest

final class NavigationRailFrameIntegrationTests: OrotFailFastTestCase {
    @MainActor
    func testGeometryPayloadSeparatesActualWindowFromContractedSensor() throws {
        let scene = try foregroundScene()
        let window = makeSceneWindow(in: scene, frame: CGRect(x: 0, y: 0, width: 951, height: 669))
        let host = UIView(frame: CGRect(x: 24, y: 10, width: 843, height: 625))
        window.addSubview(host)
        let sensor = NavigationGeometryView(frame: host.bounds)
        host.addSubview(sensor)
        var snapshot: [AnyHashable: Any]?
        sensor.onGeometryChange = { snapshot = $0 }
        sensor.layoutIfNeeded()
        let payload = try XCTUnwrap(snapshot)
        let windowBounds = try XCTUnwrap(payload["windowBounds"] as? [String: Double])
        let viewportBounds = try XCTUnwrap(payload["viewportBounds"] as? [String: Double])
        XCTAssertEqual(windowBounds["width"], Double(window.bounds.width))
        XCTAssertEqual(windowBounds["height"], Double(window.bounds.height))
        let measuredHost = sensor.convert(sensor.bounds, to: window)
        XCTAssertEqual(viewportBounds["x"], Double(measuredHost.minX))
        XCTAssertEqual(viewportBounds["y"], Double(measuredHost.minY))
        XCTAssertEqual(viewportBounds["width"], Double(measuredHost.width))
        XCTAssertNotEqual(windowBounds, viewportBounds)
    }

    @MainActor
    func testNativeRailFramesUseWindowSideSpaceAndClearExpandedIndicators() async throws {
        // These are geometry fixtures, not a claim of measured Duo runtime acceptance.
        // Convert actual UIKit frames through an offset host to catch local/window confusion.
        let scene = try foregroundScene()
        let window = makeSceneWindow(in: scene, frame: CGRect(x: 0, y: 0, width: 951, height: 669))
        let controller = UIViewController()
        window.rootViewController = controller
        controller.view.frame = window.bounds
        window.isHidden = false
        defer { window.isHidden = true }
        let host = UIView(frame: CGRect(x: 24, y: 10, width: 843, height: 625))
        controller.view.addSubview(host)
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 783, y: 0, width: 60, height: 625))
        host.addSubview(surface)
        surface.railAvailableHeight = 669
        surface.layoutMode = "right"
        surface.railRightInset = 12
        surface.railTopInset = 192
        surface.railBottomInset = 46
        let systemRegion = CGRect(x: 867, y: 0, width: 84, height: 180)
        let contentSafeFrame = CGRect(x: 0, y: 0, width: 867, height: 635)
        // The production rail's fixed height belongs to exactly five 52pt tabs.
        surface.actions = [("home", "house.fill"), ("records", "doc.text"),
                           ("schedule", "calendar"), ("ai", "sparkles"), ("settings", "gearshape")].map { pair -> [String: Any] in
            let (tab, symbol) = pair
            return ["id": "tab-\(tab)", "label": tab, "accessibilityLabel": "\(tab) tab",
                    "testID": "navigation-tab-\(tab)", "rootTab": true, "selected": tab == "home",
                    "systemImageName": symbol]
        } as NSArray
        surface.layoutIfNeeded()
        let portal = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? NavigationWindowRailHost }.first)
        portal.layoutIfNeeded()
        let root = try XCTUnwrap(portal.subviews.compactMap { $0 as? NavigationRootGlassBar }.first)
        let rootFrame = root.convert(root.bounds, to: window)
        verify(rootFrame, in: window, avoiding: systemRegion, content: contentSafeFrame)
        XCTAssertEqual(rootFrame.height, NavigationRootGlassBar.railHeight, accuracy: 0.5)
        let rootStack = try XCTUnwrap(root.contentView.subviews.compactMap { $0 as? UIStackView }.first)
        rootStack.layoutIfNeeded()
        let rootButtons = rootStack.arrangedSubviews.compactMap { $0 as? UIButton }
        XCTAssertEqual(rootButtons.count, 5)
        for button in rootButtons {
            // Centered root targets keep their 44pt minimum inside the 48pt bar.
            XCTAssertGreaterThanOrEqual(button.bounds.width, 44)
            XCTAssertLessThanOrEqual(button.bounds.width, 48)
            XCTAssertEqual(button.bounds.height, 52, accuracy: 0.5)
            XCTAssertTrue(rootFrame.contains(button.convert(button.bounds, to: window)))
            let center = button.convert(CGPoint(x: button.bounds.midX, y: button.bounds.midY), to: window)
            XCTAssertTrue(window.hitTest(center, with: nil) === button)
        }

        surface.actions = [
            ["id": "back", "label": "Back", "accessibilityLabel": "Back", "testID": "navigation-back"],
            ["id": "home", "label": "Home", "accessibilityLabel": "Home", "testID": "navigation-home"],
        ] as NSArray
        surface.layoutIfNeeded()
        portal.layoutIfNeeded()
        let stack = try XCTUnwrap(portal.subviews.compactMap { $0 as? UIStackView }.first)
        stack.layoutIfNeeded()
        let contextualFrame = stack.convert(stack.bounds, to: window)
        verify(contextualFrame, in: window, avoiding: systemRegion, content: contentSafeFrame)
        XCTAssertEqual(contextualFrame.minY - systemRegion.maxY, 12, accuracy: 0.5)
        let buttons = stack.arrangedSubviews.compactMap { $0 as? UIButton }
        XCTAssertEqual(buttons.count, 2)
        for button in buttons {
            XCTAssertEqual(button.bounds.width, 48, accuracy: 0.5)
            XCTAssertEqual(button.bounds.height, 48, accuracy: 0.5)
            XCTAssertTrue(contextualFrame.contains(button.convert(button.bounds, to: window)))
            let center = button.convert(CGPoint(x: button.bounds.midX, y: button.bounds.midY), to: window)
            XCTAssertTrue(window.hitTest(center, with: nil) === button)
        }
        // A transparent lane must not swallow content gestures or the trailing gap.
        XCTAssertFalse(window.hitTest(CGPoint(x: 945, y: 300), with: nil) is UIControl)
        surface.railAvailableHeight = 469
        surface.layoutIfNeeded()
        portal.layoutIfNeeded()
        stack.layoutIfNeeded()
        XCTAssertEqual(stack.convert(stack.bounds, to: window).maxY, 423, accuracy: 0.5)
        XCTAssertTrue(stack.arrangedSubviews.compactMap { $0 as? UIButton }.first === buttons.first)
        surface.isHidden = true
        XCTAssertTrue(portal.isHidden)
        surface.isHidden = false
        let modal = UIViewController()
        modal.modalPresentationStyle = .overFullScreen
        await withCheckedContinuation { continuation in
            controller.present(modal, animated: false) { continuation.resume() }
        }
        // Reflow while a presentation already exists must not raise the rail above it.
        surface.railAvailableHeight = 449
        surface.layoutIfNeeded()
        portal.layoutIfNeeded()
        let center = buttons[0].convert(CGPoint(x: 24, y: 24), to: window)
        XCTAssertFalse(window.hitTest(center, with: nil) === buttons[0])
        await withCheckedContinuation { continuation in
            modal.dismiss(animated: false) { continuation.resume() }
        }
        surface.layoutMode = "bottom"
        XCTAssertNil(portal.superview)
        surface.layoutMode = "right"
        XCTAssertNotNil(portal.superview)
        surface.removeFromSuperview()
        XCTAssertNil(portal.superview)
        let nextWindow = makeSceneWindow(in: scene, frame: window.frame)
        let nextController = UIViewController()
        nextWindow.rootViewController = nextController
        nextController.view.frame = nextWindow.bounds
        nextWindow.isHidden = false
        defer { nextWindow.isHidden = true }
        nextController.view.addSubview(surface)
        surface.layoutIfNeeded()
        portal.layoutIfNeeded()
        stack.layoutIfNeeded()
        XCTAssertTrue(portal.superview === nextController.view)
        XCTAssertFalse(controller.view.subviews.contains(portal))
        let migratedCenter = buttons[0].convert(CGPoint(x: 24, y: 24), to: nextWindow)
        XCTAssertTrue(nextWindow.hitTest(migratedCenter, with: nil) === buttons[0])
        surface.removeFromSuperview()
        XCTAssertNil(portal.superview)
    }

    @MainActor
    private func verify(_ frame: CGRect, in window: UIWindow, avoiding systemRegion: CGRect, content: CGRect) {
        XCTAssertFalse(frame.isEmpty)
        XCTAssertTrue(window.bounds.contains(frame))
        XCTAssertEqual(frame.width, 48, accuracy: 0.5)
        XCTAssertEqual(window.bounds.maxX - frame.maxX, 12, accuracy: 0.5)
        XCTAssertGreaterThanOrEqual(frame.minY - systemRegion.maxY, 12)
        XCTAssertFalse(frame.intersects(systemRegion))
        XCTAssertGreaterThan(frame.minX, content.maxX)
    }

    /// Uses the integration host's connected foreground scene for real UIKit window ownership.
    @MainActor
    private func foregroundScene() throws -> UIWindowScene {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return try XCTUnwrap(scene, "The integration host must have a foreground window scene.")
    }

    /// Keeps deterministic geometry while avoiding UIKit's deprecated frame-only window initializer.
    @MainActor
    private func makeSceneWindow(in scene: UIWindowScene, frame: CGRect) -> UIWindow {
        let window = UIWindow(windowScene: scene)
        window.frame = frame
        XCTAssertTrue(window.windowScene === scene)
        return window
    }
}
