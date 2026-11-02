@testable import Orot
import UIKit
import UniformTypeIdentifiers
import XCTest

final class WindowPresentationAnchorIntegrationTests: XCTestCase {
    @MainActor
    func testBridgeFallbackUsesTheSingleForegroundKeyWindow() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let root = try XCTUnwrap(window.rootViewController)
        root.loadViewIfNeeded()
        // A test-owned root-only window keeps bridge selection independent of the app's navigation hierarchy.
        XCTAssertTrue(root.children.isEmpty)
        XCTAssertNil(root.presentedViewController)
        let source = try XCTUnwrap(root.viewIfLoaded)
        let originalSubviewCount = source.subviews.count
        let item = try autoreleasepool { () throws -> UIView in
            var anchor = WindowPresentationAnchor.resolve(foregroundKeyWindows: [window])
            XCTAssertTrue(try XCTUnwrap(anchor).window === window)
            XCTAssertTrue(try XCTUnwrap(anchor).isCurrent)
            XCTAssertEqual(source.subviews.count, originalSubviewCount + 1)
            // Explicit popovers keep exact geometry and retain one region after the initiating anchor is released.
            var controller: UIViewController? = UIViewController()
            controller?.modalPresentationStyle = .popover
            XCTAssertEqual(try XCTUnwrap(anchor).apply(to: XCTUnwrap(controller)), true)
            let item = try XCTUnwrap(controller?.popoverPresentationController?.sourceItem as? UIView)
            XCTAssertTrue(type(of: item) == UIView.self)
            XCTAssertEqual(try XCTUnwrap(anchor).apply(to: XCTUnwrap(controller)), true)
            XCTAssertTrue(controller?.popoverPresentationController?.sourceItem === item)
            XCTAssertEqual(source.subviews.count, originalSubviewCount + 1)
            let region = CGRect(x: source.bounds.midX, y: source.bounds.midY, width: 1, height: 1)
            XCTAssertEqual(item.frame(in: window), source.convert(region, to: window))
            let foreignWindow = try UIWindow(windowScene: XCTUnwrap(window.windowScene))
            XCTAssertNil(WindowPresentationAnchor.resolve(from: foreignWindow))
            anchor = nil
            XCTAssertTrue(item.superview === source)
            controller = nil
            return item
        }
        XCTAssertNil(item.superview)
        XCTAssertEqual(source.subviews.count, originalSubviewCount)
        try assertBridgeFallbackSelectsRootPresenter(in: window, root: root)
    }

    @MainActor
    func testAttachedCallerViewKeepsSystemFilePickerInItsOwningWindow() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let root = try XCTUnwrap(window.rootViewController)
        let screenBounds = try XCTUnwrap(window.windowScene).screen.coordinateSpace.bounds
        let halfWidth = screenBounds.width / 2
        let splitSideFrames = [
            CGRect(x: screenBounds.minX, y: screenBounds.minY, width: halfWidth, height: screenBounds.height),
            CGRect(x: screenBounds.midX, y: screenBounds.minY, width: halfWidth, height: screenBounds.height),
        ]
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 32, height: 24))
        let sourceRect = CGRect(x: 3, y: 5, width: 9, height: 7)
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }

        // Test-owned windows exercise both Split View coordinate origins without a private gesture.
        for sideFrame in splitSideFrames {
            window.frame = sideFrame
            root.view.setNeedsLayout()
            root.view.layoutIfNeeded()
            let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source, sourceRect: sourceRect))
            XCTAssertTrue(anchor.window === window)

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            picker.modalPresentationStyle = .popover
            let configured = anchor.apply(to: picker)
            // UIKit keeps this picker as a form sheet even when a popover is requested; nil means
            // no popover was configured.
            XCTAssertEqual(picker.modalPresentationStyle, .formSheet)
            XCTAssertNil(picker.popoverPresentationController)
            XCTAssertNil(configured)
            var didPresent: Bool?
            let presented = expectation(description: "The document picker stays on the source window")
            anchor.present(picker, animated: false) { result in
                didPresent = result
                presented.fulfill()
            }
            wait(for: [presented], timeout: 5)
            XCTAssertEqual(didPresent, true)
            XCTAssertTrue(anchor.presentationRelationshipMatches(picker))
            XCTAssertTrue(anchor.presentedControllerSharesWindow(picker))

            let resizedFrame = CGRect(
                x: sideFrame.minX,
                y: sideFrame.minY,
                width: sideFrame.width * 0.9,
                height: sideFrame.height,
            )
            window.frame = resizedFrame
            root.view.setNeedsLayout()
            root.view.layoutIfNeeded()
            XCTAssertTrue(picker.presentingViewController?.viewIfLoaded?.window === window)
            XCTAssertTrue(anchor.presentedControllerSharesWindow(picker))
            XCTAssertTrue(window.isKeyWindow)
            XCTAssertTrue(source.window === window)
            XCTAssertTrue(source.convert(sourceRect, to: window).intersects(window.bounds))

            let dismissed = expectation(description: "The document picker closes before testing the other window side")
            picker.dismiss(animated: false) { dismissed.fulfill() }
            wait(for: [dismissed], timeout: 5)
            XCTAssertNil(picker.presentingViewController)
            XCTAssertNil(picker.viewIfLoaded?.window)
        }
    }

    @MainActor
    func testBridgeFallbackRejectsMultipleKeyWindowCandidates() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let scene = try XCTUnwrap(window.windowScene)
        // Both candidates are test-owned windows in the same foreground scene; ambiguity must fail closed.
        let otherCandidate = UIWindow(windowScene: scene)
        otherCandidate.frame = window.bounds
        otherCandidate.rootViewController = UIViewController()
        XCTAssertNil(WindowPresentationAnchor.resolve(foregroundKeyWindows: [window, otherCandidate]))
    }

    @MainActor
    func testPopoverAnchorRejectsARegionOutsideItsWindow() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let root = try XCTUnwrap(window.rootViewController)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 10, height: 10))
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }

        let offWindowRect = CGRect(x: 10000, y: 10000, width: 1, height: 1)
        XCTAssertNil(WindowPresentationAnchor.resolve(from: source, sourceRect: offWindowRect))
    }

    @MainActor
    func testMovingTheSourceRegionOutOfWindowInvalidatesTheAnchor() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let root = try XCTUnwrap(window.rootViewController)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 10, height: 10))
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source))

        source.frame.origin = CGPoint(x: 10000, y: 10000)
        let controller = UIViewController()
        controller.modalPresentationStyle = .popover
        XCTAssertFalse(anchor.isCurrent)
        XCTAssertEqual(anchor.apply(to: controller), false)
        var presented: Bool?
        anchor.present(controller, animated: false) { presented = $0 }
        XCTAssertEqual(presented, false)
        XCTAssertNil(controller.presentingViewController)
    }

    @MainActor
    func testDetachedSourceViewInvalidatesTheResolvedAnchorBeforePresentation() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let root = try XCTUnwrap(window.rootViewController)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 1, height: 1))
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source))

        source.removeFromSuperview()
        let controller = UIViewController()
        controller.modalPresentationStyle = .popover
        XCTAssertFalse(anchor.isCurrent)
        XCTAssertEqual(anchor.apply(to: controller), false)
        var presented: Bool?
        anchor.present(controller, animated: false) { presented = $0 }
        XCTAssertEqual(presented, false)
        XCTAssertNil(controller.presentingViewController)
    }

    @MainActor
    func testChangingTheKeyWindowInvalidatesTheResolvedAnchor() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let scene = try XCTUnwrap(window.windowScene)
        let root = try XCTUnwrap(window.rootViewController)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 1, height: 1))
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source))

        let replacement = UIWindow(windowScene: scene)
        replacement.rootViewController = UIViewController()
        replacement.makeKeyAndVisible()
        defer {
            replacement.isHidden = true
            window.makeKeyAndVisible()
        }

        XCTAssertFalse(anchor.isCurrent)
        let controller = UIViewController()
        XCTAssertEqual(anchor.apply(to: controller), false)
        var presented: Bool?
        anchor.present(controller, animated: false) { presented = $0 }
        XCTAssertEqual(presented, false)
        XCTAssertNil(controller.presentingViewController)
    }

    @MainActor
    func testChangingThePresentationStackInvalidatesTheResolvedPresenter() throws {
        let fixture = try WindowPresentationAnchorTestWindow()
        let window = fixture.window
        defer { fixture.restore() }
        let root = try XCTUnwrap(window.rootViewController)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 10, height: 10))
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source))

        let newTopmostController = UIViewController()
        root.addChild(newTopmostController)
        newTopmostController.view.frame = root.view.bounds
        newTopmostController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.view.addSubview(newTopmostController.view)
        newTopmostController.didMove(toParent: root)
        defer {
            newTopmostController.willMove(toParent: nil)
            newTopmostController.view.removeFromSuperview()
            newTopmostController.removeFromParent()
        }

        let controller = UIViewController()
        XCTAssertFalse(anchor.isCurrent)
        var presented: Bool?
        anchor.present(controller, animated: false) { presented = $0 }
        XCTAssertEqual(presented, false)
        XCTAssertNil(controller.presentingViewController)

        try assertBridgeFallbackSelectsVisibleModalPresenter(in: window, root: root)
    }
}
