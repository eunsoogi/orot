import UIKit

/// Supplies exact popover geometry without retaining a window or accepting a source moved to another scene.
@available(iOS 17.0, *)
@MainActor
final class PopoverSourceRegion: NSObject, @MainActor UIPopoverPresentationControllerSourceItem {
    private weak var view: UIView?
    private weak var window: UIWindow?
    private let rect: CGRect

    init(view: UIView, rect: CGRect, window: UIWindow) {
        self.view = view
        self.rect = rect
        self.window = window
    }

    /// UIKit imports frameInView: under this name; callers verify it through the public frame(in:) overlay.
    func __frame(in referenceView: UIView) -> CGRect {
        guard let view, let window, view.window === window,
              referenceView === window || referenceView.window === window,
              window.windowScene?.activationState == .foregroundActive,
              window.isKeyWindow, !window.isHidden, window.alpha > 0,
              !view.isHidden, view.alpha > 0,
              rect.width > 0, rect.height > 0, rect.intersects(view.bounds),
              view.convert(rect, to: window).intersects(window.bounds)
        else { return .null }
        // Presentation can cover the source controller; presenter ownership is checked separately by the anchor.
        return view.convert(rect, to: referenceView)
    }
}
