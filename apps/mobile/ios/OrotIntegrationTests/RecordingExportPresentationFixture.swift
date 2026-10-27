import Foundation
@testable import Orot
import UIKit
import XCTest

extension RecordingExportIntegrationTests {
    /// Exercise actual anchor confirmation and rejection without relying on UIKit to remove an activity source.
    @MainActor
    func assertDetachedSourceExport(originalWindow: UIWindow, invalidatesWindowVisibility: Bool) throws {
        let operation = try RecordingExportFiles.transcriptFile(text: "share this transcript")
        var presentedActivity: UIActivityViewController?
        addTeardownBlock { @MainActor in
            // A dismissal callback alone cannot release the file while either live UIKit relationship remains.
            guard presentedActivity?.presentingViewController == nil, presentedActivity?.viewIfLoaded?.window == nil else {
                XCTFail("The live activity still owns its export after teardown dismissal")
                return
            }
            try RecordingExportFiles.finish(operation.directory)
        }
        var cleanupCount = 0
        let lifecycle = RecordingExportPresentationLifecycle {
            cleanupCount += 1
            do {
                try RecordingExportFiles.finish(operation.directory)
                return true
            } catch {
                XCTFail("Unexpected export cleanup error: \(error)")
                return false
            }
        }

        let scene = try XCTUnwrap(originalWindow.windowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = originalWindow.frame
        let root = UIViewController()
        window.rootViewController = root
        window.makeKeyAndVisible()
        defer {
            window.alpha = 1
            window.isHidden = true
            originalWindow.makeKeyAndVisible()
        }

        XCTAssertGreaterThan(window.alpha, 0)
        let child = DetachedSourcePresenter()
        root.addChild(child)
        child.view.frame = CGRect(x: 0, y: 0, width: window.bounds.width / 2, height: window.bounds.height)
        root.view.addSubview(child.view)
        child.didMove(toParent: root)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 12, height: 12))
        child.view.addSubview(source)

        // Request fullscreen sharing, but control detachment because UIKit may retain an activity presenter.
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source))
        let modal = UIActivityViewController(activityItems: [operation.file], applicationActivities: nil)
        presentedActivity = modal
        modal.modalPresentationStyle = .fullScreen
        // The hook runs inside real UIKit completion, before the anchor evaluates its existing ownership predicate.
        var completionHookCount = 0
        child.beforePresentationCompletion = { [weak source, weak window] in
            completionHookCount += 1
            source?.removeFromSuperview()
            // Inject visibility loss only in this owned window; the real anchor callback supplies its rejection.
            if invalidatesWindowVisibility {
                window?.alpha = 0
            }
        }
        // Keep a failed scenario's export alive until the real modal has been dismissed during teardown.
        addTeardownBlock { @MainActor in
            if modal.presentingViewController != nil || modal.viewIfLoaded?.window != nil {
                await withCheckedContinuation { continuation in
                    modal.dismiss(animated: false) { continuation.resume() }
                }
            }
            window.alpha = 1
        }
        var didPresent: Bool?
        let presented = expectation(description: "The activity completes presentation in its source window")
        anchor.present(modal, animated: false) { result in
            didPresent = result
            presented.fulfill()
        }
        wait(for: [presented], timeout: 5)

        XCTAssertEqual(completionHookCount, 1)
        XCTAssertEqual(didPresent, !invalidatesWindowVisibility)
        XCTAssertTrue(window.isKeyWindow)
        XCTAssertFalse(window.isHidden)
        XCTAssertEqual(window.windowScene?.activationState, .foregroundActive)
        XCTAssertEqual(window.alpha, invalidatesWindowVisibility ? 0 : 1)
        XCTAssertTrue(modal.presentingViewController === root)
        XCTAssertTrue(root.presentedViewController === modal)
        XCTAssertTrue(modal.viewIfLoaded?.window === window)
        // Require a genuinely detached source while the original activity relationship stays live.
        XCTAssertNil(source.window)

        var unavailableRejections = 0
        let actualConfirmation = try XCTUnwrap(didPresent)
        let disposition = lifecycle.completePresentation(
            didPresent: actualConfirmation,
            controllerIsLive: modal.presentingViewController != nil || modal.viewIfLoaded?.window != nil,
            rejectUnavailable: { unavailableRejections += 1 },
        )
        XCTAssertEqual(disposition, invalidatesWindowVisibility ? .liveButUnverified : .confirmed)
        XCTAssertEqual(cleanupCount, 0)
        XCTAssertEqual(unavailableRejections, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: operation.file.path))

        let dismissed = expectation(description: "The activity is dismissed before export cleanup")
        modal.dismiss(animated: false) { dismissed.fulfill() }
        wait(for: [dismissed], timeout: 5)

        XCTAssertNil(modal.presentingViewController)
        XCTAssertNil(modal.viewIfLoaded?.window)
        // A failed dismissal must leave cleanup to the modal-first teardown rather than remove a live export.
        guard modal.presentingViewController == nil, modal.viewIfLoaded?.window == nil else { return }
        window.alpha = 1
        XCTAssertTrue(lifecycle.finishIfNeeded())
        XCTAssertEqual(cleanupCount, 1)
        XCTAssertTrue(lifecycle.finishIfNeeded())
        XCTAssertEqual(cleanupCount, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: operation.file.path))
        XCTAssertEqual(RecordingExportFiles.residueCount(), 0)
    }
}

/// Changes only the synthetic initiating view and its test-owned window before the production completion runs.
@MainActor
private final class DetachedSourcePresenter: UIViewController {
    var beforePresentationCompletion: (() -> Void)?

    override func present(_ controller: UIViewController, animated: Bool, completion: (() -> Void)? = nil) {
        super.present(controller, animated: animated) { [weak self] in
            self?.beforePresentationCompletion?()
            completion?()
        }
    }
}
