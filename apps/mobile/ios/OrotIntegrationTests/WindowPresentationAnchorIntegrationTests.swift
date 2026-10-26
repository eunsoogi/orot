@testable import Orot
import UIKit
import UniformTypeIdentifiers
import XCTest

final class WindowPresentationAnchorIntegrationTests: XCTestCase {
    @MainActor
    func testBridgeFallbackUsesTheSingleForegroundKeyWindow() throws {
        let window = try foregroundKeyWindow()
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(foregroundKeyWindows: [window]))
        XCTAssertTrue(anchor.window === window)
        XCTAssertTrue(anchor.isCurrent)
    }

    @MainActor
    func testAttachedCallerViewAnchorsFilePickerPopoverToItsOwningWindow() throws {
        let (window, originalWindow) = try isolatedKeyWindow()
        defer {
            window.isHidden = true
            originalWindow.makeKeyAndVisible()
        }
        let root = try XCTUnwrap(window.rootViewController)
        let screenBounds = try XCTUnwrap(window.windowScene).screen.coordinateSpace.bounds
        let halfWidth = screenBounds.width / 2
        let splitSideFrames = [
            CGRect(x: screenBounds.minX, y: screenBounds.minY, width: halfWidth, height: screenBounds.height),
            CGRect(x: screenBounds.midX, y: screenBounds.minY, width: halfWidth, height: screenBounds.height),
        ]
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 1, height: 1))
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }

        // A test-owned window in each screen half exercises both Split View coordinate origins without a private multitasking gesture.
        for sideFrame in splitSideFrames {
            window.frame = sideFrame
            root.view.setNeedsLayout()
            root.view.layoutIfNeeded()
            let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source))
            XCTAssertTrue(anchor.window === window)

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            picker.modalPresentationStyle = .popover
            XCTAssertEqual(anchor.apply(to: picker), true)
            XCTAssertTrue(picker.popoverPresentationController?.sourceView?.window === window)
            XCTAssertEqual(picker.popoverPresentationController?.sourceRect, source.bounds)

            var didPresent: Bool?
            let presented = expectation(description: "The document picker stays on the source window")
            anchor.present(picker, animated: false) { result in
                didPresent = result
                presented.fulfill()
            }
            wait(for: [presented], timeout: 5)
            XCTAssertEqual(didPresent, true)
            XCTAssertTrue(anchor.matchesPresenter(picker))
            XCTAssertTrue(anchor.presenterSharesWindow(picker))

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
            if let popover = picker.popoverPresentationController, let popoverSource = popover.sourceView {
                XCTAssertTrue(popoverSource.window === window)
                XCTAssertTrue(popoverSource.convert(popover.sourceRect, to: window).intersects(window.bounds))
            }

            let dismissed = expectation(description: "The document picker closes before testing the other window side")
            picker.dismiss(animated: false) { dismissed.fulfill() }
            wait(for: [dismissed], timeout: 5)
        }
    }

    @MainActor
    func testBridgeFallbackRejectsMultipleKeyWindowCandidates() throws {
        let window = try foregroundKeyWindow()
        let scene = try XCTUnwrap(window.windowScene)
        // The injected bridge candidate list must fail closed before it can choose either window.
        let otherCandidate = UIWindow(windowScene: scene)
        otherCandidate.frame = window.bounds
        XCTAssertNil(WindowPresentationAnchor.resolve(foregroundKeyWindows: [window, otherCandidate]))
    }

    @MainActor
    func testPopoverAnchorRejectsARegionOutsideItsWindow() throws {
        let window = try foregroundKeyWindow()
        let root = try XCTUnwrap(window.rootViewController)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 10, height: 10))
        root.view.addSubview(source)
        defer { source.removeFromSuperview() }

        let offWindowRect = CGRect(x: 10000, y: 10000, width: 1, height: 1)
        XCTAssertNil(WindowPresentationAnchor.resolve(from: source, sourceRect: offWindowRect))
    }

    @MainActor
    func testMovingTheSourceRegionOutOfWindowInvalidatesTheAnchor() throws {
        let window = try foregroundKeyWindow()
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
        let window = try foregroundKeyWindow()
        let root = try XCTUnwrap(window.rootViewController)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 1, height: 1))
        root.view.addSubview(source)
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
        let window = try foregroundKeyWindow()
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
        let (window, originalWindow) = try isolatedKeyWindow()
        defer {
            window.isHidden = true
            originalWindow.makeKeyAndVisible()
        }
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
    }

    @MainActor
    private func foregroundKeyWindow() throws -> UIWindow {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            .filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0 }
        XCTAssertEqual(windows.count, 1)
        return try XCTUnwrap(windows.first)
    }

    @MainActor
    private func isolatedKeyWindow() throws -> (window: UIWindow, originalWindow: UIWindow) {
        let originalWindow = try foregroundKeyWindow()
        let scene = try XCTUnwrap(originalWindow.windowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = originalWindow.frame
        window.rootViewController = UIViewController()
        window.makeKeyAndVisible()
        return (window, originalWindow)
    }
}
