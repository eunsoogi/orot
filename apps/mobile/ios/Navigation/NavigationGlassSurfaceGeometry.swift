import React
import UIKit

extension NavigationGlassSurfaceView {
    /// The React surface owns portal admission; the control parent owns frame publication.
    /// A warm overlay change must wake both when the existing portal is outside the new host.
    func invalidateOverlayGeometry() {
        if layoutMode != "bottom" {
            setNeedsLayout()
        }
        (rootBar.isHidden ? innerActions as UIView : rootBar).superview?.setNeedsLayout()
    }

    /// Pins only an admitted window-owned right Back, keeping the old insets for local and left renderers.
    func contextualRailTop(hostHeight: CGFloat, mountedToWindow: Bool) -> CGFloat {
        let hasBack = renderedActions.contains { $0.id == "back" }
        let hasRootTabs = renderedActions.contains(where: \.rootTab)
        let end = hostHeight - railBottomInset
        if layoutMode == "right", !isPageDock, hasBack, mountedToWindow,
           rightBackFit(hostHeight: hostHeight) == "pinned"
        {
            return railBackTopInset
        }
        // Without the right-window contract, keep Back above existing bottom-anchored root tabs.
        return layoutMode != "bottom" && hasRootTabs && hasBack
            ? end - rootBar.railHeight - NavigationRootGlassBar.contextualBackGroupHeight
            : railTopInset
    }

    private func rightBackFit(hostHeight: CGFloat) -> String {
        guard railBackTopInset.isFinite, railBackTopInset >= 0 else { return "missing-top" }
        // Non-root controls share a flexible spacer after Back, preserving their bottom anchor.
        let required = renderedActions.contains(where: \.rootTab)
            ? rootBar.railHeight + NavigationRootGlassBar.contextualBackGroupHeight
            : CGFloat(renderedActions.count) * (48 + innerActions.spacing)
        return railBackTopInset + required <= hostHeight - railBottomInset ? "pinned" : "insufficient-fit"
    }

    /// Observe only a committed, visible Back target. A right-placement calculation alone
    /// cannot distinguish a real bottom host from a native portal or frame failure.
    func visibleBackPlacement(from parent: UIView) -> String? {
        guard !isPageDock, let window, NavigationSurfaceGeometry.isVisible(self),
              renderedActions.contains(where: { $0.id == "back" }),
              innerActions.superview === parent, let button = contextualButtons["back"],
              button.window === window, button.isDescendant(of: innerActions),
              NavigationSurfaceGeometry.isVisible(button), !button.bounds.isEmpty
        else { return nil }
        let frame = button.convert(button.bounds, to: window)
        guard window.bounds.intersects(frame) else { return nil }
        if layoutMode == "bottom" {
            return "bottom-layout"
        }
        guard layoutMode == "right" else { return nil }
        guard parent is NavigationWindowRailHost else { return "local-host" }
        let fit = rightBackFit(hostHeight: parent.bounds.height)
        if fit == "pinned" {
            let intended = parent.convert(CGPoint(x: 0, y: railBackTopInset), to: window).y
            guard abs(frame.minY - intended) <= 1 else { return "pinned-frame-mismatch" }
        }
        return fit
    }

    /// Emit only distinct fixed categories on the normal explicit local diagnostic launch.
    private func observeContextualBackResolution(_ resolution: String?) {
        guard ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS"),
              resolution != lastContextualBackResolution
        else { return }
        lastContextualBackResolution = resolution
        if let resolution {
            NSLog("OROT_NAVIGATION_RIGHT_BACK resolution=%@", resolution)
        }
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
        NavigationSurfaceGeometry.publish(controls, side: layoutMode, actions: renderedActions) {
            // Read after the actual parent laid out the controls; report no geometry or identity.
            if ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") {
                observeContextualBackResolution(visibleBackPlacement(from: parent))
            }
        }
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

@objc(NavigationGlassViewManager)
final class NavigationGlassViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        NavigationGlassSurfaceView()
    }
}

/// Sends only physical control geometry; a sensor ignores notifications from other windows.
enum NavigationSurfaceGeometry {
    static func isVisible(_ view: UIView) -> Bool {
        var ancestor: UIView? = view
        while let current = ancestor {
            guard !current.isHidden, current.alpha > 0.01 else { return false }
            ancestor = current.superview
        }
        return true
    }

    static func publish(_ view: UIView, side: String, actions: [NavigationActionDescriptor], committed: () -> Void) {
        #if OROT_TESTS
            // Record requests separately so a missing callback differs from a guarded-out publication.
            TestLifecycleObservation.record("navigation-frame-publication-request", fields: ["side": side, "attached": view.window != nil, "hidden": view.isHidden])
        #endif
        // Primary-only bottom actions do not replace the side navigation's measured frame.
        guard actions.contains(where: { $0.rootTab || $0.id == "back" || $0.id == "home" }) else { return }
        guard isVisible(view) else { return }
        view.layoutIfNeeded()
        guard !view.isHidden, let window = view.window, !view.bounds.isEmpty else { return }
        let frame = view.convert(view.bounds, to: window)
        committed()
        #if OROT_TESTS
            TestLifecycleObservation.record("navigation-frame-published", fields: ["side": side, "frame": ["x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)]])
        #endif
        NotificationCenter.default.post(name: Notification.Name("OrotNavigationSurfaceGeometryDidChange"),
                                        object: view, userInfo: ["side": side, "frame": [
                                            "x": Double(frame.minX), "y": Double(frame.minY),
                                            "width": Double(frame.width), "height": Double(frame.height),
                                        ]])
    }
}
