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
    func contextualRailTop(hostHeight: CGFloat, mountedToWindow: Bool, observe: Bool = false) -> CGFloat {
        let hasBack = renderedActions.contains { $0.id == "back" }
        let hasRootTabs = renderedActions.contains(where: \.rootTab)
        let end = hostHeight - railBottomInset
        var resolution: String?
        defer {
            if observe {
                observeContextualBackResolution(resolution)
            }
        }
        if layoutMode == "right", !isPageDock, hasBack {
            resolution = "local-host"
        }
        if resolution != nil, mountedToWindow {
            if !railBackTopInset.isFinite || railBackTopInset < 0 {
                resolution = "missing-top"
            } else {
                // Non-root controls share a flexible spacer after Back, preserving their bottom anchor.
                let required = hasRootTabs
                    ? rootBar.railHeight + NavigationRootGlassBar.contextualBackGroupHeight
                    : CGFloat(renderedActions.count) * (48 + innerActions.spacing)
                if railBackTopInset + required <= end {
                    resolution = "pinned"
                    return railBackTopInset
                }
                resolution = "insufficient-fit"
            }
        }
        // Without the right-window contract, keep Back above existing bottom-anchored root tabs.
        return layoutMode != "bottom" && hasRootTabs && hasBack
            ? end - rootBar.railHeight - NavigationRootGlassBar.contextualBackGroupHeight
            : railTopInset
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
    static func publish(_ view: UIView, side: String, actions: [NavigationActionDescriptor]) {
        #if OROT_TESTS
            // Record requests separately so a missing callback differs from a guarded-out publication.
            TestLifecycleObservation.record("navigation-frame-publication-request", fields: ["side": side, "attached": view.window != nil, "hidden": view.isHidden])
        #endif
        // Primary-only bottom actions do not replace the side navigation's measured frame.
        guard actions.contains(where: { $0.rootTab || $0.id == "back" || $0.id == "home" }) else { return }
        var ancestor: UIView? = view
        while let current = ancestor {
            guard !current.isHidden, current.alpha > 0.01 else { return }
            ancestor = current.superview
        }
        view.layoutIfNeeded()
        guard !view.isHidden, let window = view.window, !view.bounds.isEmpty else { return }
        let frame = view.convert(view.bounds, to: window)
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
