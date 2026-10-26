import UIKit

/// Binds UIKit presentations and popovers to the foreground window that owns the calling view or active app scene.
@MainActor
struct WindowPresentationAnchor {
    let window: UIWindow
    private let presenter: UIViewController
    private let sourceView: UIView
    private let sourceRect: CGRect

    /// Prefer the caller's attached view; bridge-only callers use the sole key window in the active scene.
    static func resolve(from sourceView: UIView? = nil, sourceRect: CGRect? = nil) -> Self? {
        let keyWindows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            .filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0 }
        return resolve(from: sourceView, sourceRect: sourceRect, foregroundKeyWindows: keyWindows)
    }

    /// Shares the single-window selection rule with tests that provide candidate windows directly.
    static func resolve(from sourceView: UIView? = nil, sourceRect: CGRect? = nil, foregroundKeyWindows: [UIWindow]) -> Self? {
        let window: UIWindow
        if let sourceView {
            guard let viewWindow = sourceView.window else { return nil }
            window = viewWindow
        } else {
            // A bridge call has no source view to identify its scene; ambiguity must not select another window.
            guard foregroundKeyWindows.count == 1, let keyWindow = foregroundKeyWindows.first else { return nil }
            window = keyWindow
        }

        guard window.windowScene?.activationState == .foregroundActive,
              window.isKeyWindow, !window.isHidden, window.alpha > 0,
              let root = window.rootViewController
        else { return nil }

        let presenter = topmostPresenter(from: root, in: window)
        let resolvedView = sourceView ?? presenter.view
        guard resolvedView.window === window, !resolvedView.isHidden, resolvedView.alpha > 0 else { return nil }

        let resolvedRect = sourceRect ?? (sourceView == nil
            ? CGRect(x: resolvedView.bounds.midX, y: resolvedView.bounds.midY, width: 1, height: 1)
            : resolvedView.bounds)
        let rectInWindow = resolvedView.convert(resolvedRect, to: window)
        // Popovers need a visible source region; reject stale or off-window coordinates before UIKit receives them.
        guard resolvedRect.width > 0,
              resolvedRect.height > 0,
              resolvedRect.intersects(resolvedView.bounds),
              rectInWindow.intersects(window.bounds)
        else { return nil }
        return Self(window: window, presenter: presenter, sourceView: resolvedView, sourceRect: resolvedRect)
    }

    /// Confirms the presenter, source region, and foreground key window still match the resolved anchor.
    var isCurrent: Bool {
        let rectInWindow = sourceView.convert(sourceRect, to: window)
        guard isAttachedToWindow,
              window.isKeyWindow,
              !sourceView.isHidden,
              sourceView.alpha > 0,
              sourceRect.intersects(sourceView.bounds),
              rectInWindow.intersects(window.bounds),
              let root = window.rootViewController
        else { return false }
        return Self.topmostPresenter(from: root, in: window) === presenter
    }

    /// Presents through the resolved controller and confirms UIKit attached it to the same window.
    func present(_ controller: UIViewController, animated: Bool = true, completion: @escaping (Bool) -> Void) {
        guard isCurrent, apply(to: controller) != false else {
            completion(false)
            return
        }
        presenter.present(controller, animated: animated) { [weak self, weak controller] in
            guard let self, let controller else {
                completion(false)
                return
            }
            completion(matchesPresenter(controller) && presenterSharesWindow(controller) && isAttachedToWindow)
        }
    }

    /// Sets the UIKit popover source in the same window used for presentation.
    @discardableResult
    func apply(to controller: UIViewController) -> Bool? {
        guard isCurrent else { return false }
        guard let popover = controller.popoverPresentationController else { return nil }
        popover.sourceView = sourceView
        popover.sourceRect = sourceRect
        return isCurrent && popover.sourceView?.window === window && popover.sourceRect == sourceRect
    }

    /// Confirms the presented controller and its presenter remain attached to this anchor's window.
    func matchesPresenter(_ controller: UIViewController) -> Bool {
        controller.presentingViewController === presenter
    }

    /// Verifies UIKit did not move the selected presenter to another window before presentation completed.
    func presenterSharesWindow(_ controller: UIViewController) -> Bool {
        controller.presentingViewController?.viewIfLoaded?.window === window
            && presenter.viewIfLoaded?.window === window
    }

    #if OROT_TESTS
        /// Records only public geometry and identity relationships for native presentation regression tests.
        func testObservation(popoverAvailable: Bool, popoverConfigured: Bool) -> [String: Any] {
            let rect = sourceView.convert(sourceRect, to: window)
            return [
                "presenterSharesWindow": presenter.viewIfLoaded?.window === window,
                "sourceViewSharesWindow": sourceView.window === window,
                "windowIsKey": window.isKeyWindow,
                "windowSceneIsForegroundActive": window.windowScene?.activationState == .foregroundActive,
                "popoverAvailable": popoverAvailable,
                "popoverConfigured": popoverConfigured,
                "sourceRectIntersectsWindow": rect.intersects(window.bounds),
            ]
        }
    #endif

    private static func topmostPresenter(from root: UIViewController, in window: UIWindow) -> UIViewController {
        if let presented = root.presentedViewController, !presented.isBeingDismissed {
            return topmostPresenter(from: presented, in: window)
        }
        if let navigation = root as? UINavigationController, let visible = navigation.visibleViewController {
            return topmostPresenter(from: visible, in: window)
        }
        if let tabs = root as? UITabBarController, let selected = tabs.selectedViewController {
            return topmostPresenter(from: selected, in: window)
        }
        if let visibleChild = root.children.last(where: {
            guard let view = $0.viewIfLoaded else { return false }
            return view.window === window && !view.isHidden && view.alpha > 0
        }) {
            return topmostPresenter(from: visibleChild, in: window)
        }
        return root
    }

    private var isAttachedToWindow: Bool {
        window.windowScene?.activationState == .foregroundActive
            && !window.isHidden
            && window.alpha > 0
            && sourceView.window === window
            && presenter.viewIfLoaded?.window === window
    }
}
