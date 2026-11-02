import UIKit

extension NavigationGlassSurfaceView {
    /// Invalidate both native labels and exported metrics when the system text size changes.
    func observeNavigationTextSize() {
        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: NavigationGlassSurfaceView, _: UITraitCollection) in
                view.navigationTextSizeChanged()
            }
        } else {
            NotificationCenter.default.addObserver(self, selector: #selector(navigationTextSizeChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
        }
    }

    @objc func navigationTextSizeChanged() {
        guard !renderedActions.isEmpty else { return }
        lastPageMetricsKey = ""
        render(renderedActions)
        setNeedsLayout()
    }

    /// The mounted host owns measurement, including layout changes outside the React surface.
    func publishNavigationGeometry(from parent: UIView) {
        let controls: UIView = rootBar.isHidden ? innerActions : rootBar
        guard !isPageDock, controls.superview === parent else { return }
        NavigationSurfaceGeometry.publish(controls, side: layoutMode, actions: renderedActions)
    }

    /// Finish on the actual parent so portal-mounted controls publish their newly rendered frame.
    func finishRendering() {
        rootBar.setBottomHeight(max(60, bottomHeight))
        let controls: UIView = rootBar.isHidden ? innerActions : rootBar
        guard let parent = controls.superview else { return }
        parent.setNeedsLayout()
        parent.layoutIfNeeded()
    }
}
