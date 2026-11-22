import UIKit

extension NavigationGlassSurfaceView {
    /// Pins only an admitted window-owned right Back, keeping the old insets for local and left renderers.
    func contextualRailTop(hostHeight: CGFloat, mountedToWindow: Bool) -> CGFloat {
        let hasBack = renderedActions.contains { $0.id == "back" }
        let hasRootTabs = renderedActions.contains(where: \.rootTab)
        let end = hostHeight - railBottomInset
        if layoutMode == "right", mountedToWindow, !isPageDock, hasBack,
           railBackTopInset.isFinite, railBackTopInset >= 0
        {
            // Non-root controls share a flexible spacer after Back, preserving their bottom anchor.
            let required = hasRootTabs
                ? rootBar.railHeight + NavigationRootGlassBar.contextualBackGroupHeight
                : CGFloat(renderedActions.count) * (48 + innerActions.spacing)
            if railBackTopInset + required <= end {
                return railBackTopInset
            }
        }
        // Without the right-window contract, keep Back above existing bottom-anchored root tabs.
        return layoutMode != "bottom" && hasRootTabs && hasBack
            ? end - rootBar.railHeight - NavigationRootGlassBar.contextualBackGroupHeight
            : railTopInset
    }

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
