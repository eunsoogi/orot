@testable import Orot
import UIKit
import XCTest

/// Gives anchor tests a bare key window in the active scene and restores the app window afterward.
@MainActor
final class WindowPresentationAnchorTestWindow {
    let window: UIWindow
    private let originalWindow: UIWindow

    init() throws {
        let keyWindows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            .filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0 }
        XCTAssertEqual(keyWindows.count, 1)
        let originalWindow = try XCTUnwrap(keyWindows.first)
        let scene = try XCTUnwrap(originalWindow.windowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = originalWindow.frame
        window.rootViewController = UIViewController()
        window.makeKeyAndVisible()
        self.originalWindow = originalWindow
        self.window = window
    }

    func restore() {
        window.isHidden = true
        originalWindow.makeKeyAndVisible()
    }
}

extension WindowPresentationAnchorIntegrationTests {
    @MainActor
    func assertBridgeFallbackSelectsRootPresenter(in window: UIWindow, root: UIViewController) throws {
        XCTAssertTrue(root.children.isEmpty)
        XCTAssertNil(root.presentedViewController)
        root.definesPresentationContext = true
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(foregroundKeyWindows: [window]))
        let controller = UIViewController()
        controller.modalPresentationStyle = .overCurrentContext
        var didPresent: Bool?
        let presented = expectation(description: "Bridge fallback presents from the root-only controller")
        anchor.present(controller, animated: false) { result in
            didPresent = result
            presented.fulfill()
        }
        wait(for: [presented], timeout: 5)
        XCTAssertEqual(didPresent, true)
        XCTAssertTrue(controller.presentingViewController === root)
        XCTAssertTrue(anchor.presentedControllerSharesWindow(controller))
        let dismissed = expectation(description: "The root-only presentation is dismissed")
        controller.dismiss(animated: false) { dismissed.fulfill() }
        wait(for: [dismissed], timeout: 5)
        XCTAssertNil(controller.presentingViewController)
    }

    @MainActor
    func assertBridgeFallbackSelectsVisibleModalPresenter(in window: UIWindow, root: UIViewController) throws {
        let visibleChild = try XCTUnwrap(root.children.last)
        XCTAssertTrue(visibleChild.viewIfLoaded?.window === window)

        let visiblePresenter = UIViewController()
        visiblePresenter.modalPresentationStyle = .overFullScreen
        visiblePresenter.definesPresentationContext = true
        let modalPresented = expectation(description: "The test-owned root presents a visible modal")
        root.present(visiblePresenter, animated: false) { modalPresented.fulfill() }
        wait(for: [modalPresented], timeout: 5)
        XCTAssertTrue(visiblePresenter.presentingViewController === root)
        XCTAssertTrue(visiblePresenter.viewIfLoaded?.window === window)

        // Bridge fallback must select the visible modal instead of the covered root or child.
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(foregroundKeyWindows: [window]))
        XCTAssertTrue(anchor.window === window)
        XCTAssertTrue(anchor.isCurrent)

        let popover = UIViewController()
        popover.modalPresentationStyle = .popover
        XCTAssertEqual(anchor.apply(to: popover), true)
        let item = try XCTUnwrap(popover.popoverPresentationController?.sourceItem as? UIView)
        XCTAssertTrue(item.superview === visiblePresenter.view)
        let region = CGRect(
            x: visiblePresenter.view.bounds.midX,
            y: visiblePresenter.view.bounds.midY,
            width: 1,
            height: 1,
        )
        XCTAssertEqual(item.frame(in: window), visiblePresenter.view.convert(region, to: window))

        let nestedController = UIViewController()
        nestedController.modalPresentationStyle = .overCurrentContext
        var didPresent: Bool?
        let nestedPresented = expectation(description: "The selected modal presents in its current context")
        anchor.present(nestedController, animated: false) { result in
            didPresent = result
            nestedPresented.fulfill()
        }
        wait(for: [nestedPresented], timeout: 5)
        XCTAssertEqual(didPresent, true)
        XCTAssertTrue(nestedController.presentingViewController === visiblePresenter)
        XCTAssertTrue(anchor.presentationRelationshipMatches(nestedController))
        XCTAssertTrue(anchor.presentedControllerSharesWindow(nestedController))

        let nestedDismissed = expectation(description: "The nested presentation is dismissed")
        nestedController.dismiss(animated: false) { nestedDismissed.fulfill() }
        wait(for: [nestedDismissed], timeout: 5)
        let modalDismissed = expectation(description: "The visible modal is dismissed")
        visiblePresenter.dismiss(animated: false) { modalDismissed.fulfill() }
        wait(for: [modalDismissed], timeout: 5)
        XCTAssertNil(visiblePresenter.presentingViewController)
    }
}
