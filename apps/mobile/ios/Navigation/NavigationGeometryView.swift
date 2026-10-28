import React
import UIKit

/// Reports the edge-to-edge navigation window geometry without participating in touch handling.
final class NavigationGeometryView: UIView {
    @objc var onGeometryChange: RCTDirectEventBlock? {
        didSet { publishGeometryIfNeeded() }
    }

    private var lastSnapshotData: Data?
    private var hasHinge = false
    private var navigationWidth: Double?
    private var navigationFrame: [String: Double]?

    /// Observe public hinge identity and the actual mounted controls, without inspecting route contents.
    private func observeWindowGeometry() {
        NotificationCenter.default.addObserver(self, selector: #selector(navigationFrameChanged),
                                               name: Notification.Name("OrotNavigationSurfaceGeometryDidChange"), object: nil)
        if #available(iOS 27.1, *) {
            addInteraction(UIHingeInteraction { [weak self] _, update in
                guard let self else { return }
                hasHinge = update.hinge != nil
                publishGeometryIfNeeded()
            })
        }
    }

    @objc private func navigationFrameChanged(_ notification: Notification) {
        guard let source = notification.object as? UIView, source.window === window,
              let frame = notification.userInfo?["frame"] as? [String: Double] else { return }
        navigationFrame = frame
        if notification.userInfo?["side"] as? String != "bottom" {
            navigationWidth = frame["width"]
        }
        publishGeometryIfNeeded()
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        observeWindowGeometry()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .clear
        isOpaque = false
        observeWindowGeometry()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        lastSnapshotData = nil
        setNeedsUpdateConstraints()
        setNeedsLayout()
        publishGeometryIfNeeded()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        publishGeometryIfNeeded()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        publishGeometryIfNeeded()
    }

    override func updateConstraints() {
        // UIKit re-runs this method when a reserved region read here changes activity or frame.
        publishGeometryIfNeeded()
        super.updateConstraints()
    }

    private func publishGeometryIfNeeded() {
        guard let onGeometryChange, let window,
              bounds.width > 0, bounds.height > 0
        else {
            return
        }

        let snapshot = geometryPayload(in: window)
        guard JSONSerialization.isValidJSONObject(snapshot),
              let data = try? JSONSerialization.data(
                  withJSONObject: snapshot,
                  options: [.sortedKeys],
              ),
              data != lastSnapshotData
        else {
            return
        }

        lastSnapshotData = data
        onGeometryChange(snapshot)
    }

    private func geometryPayload(in window: UIWindow) -> [String: Any] {
        var reservedRegionEntries: [[String: Any]] = []
        var reservedRegionsSupported = false
        if #available(iOS 27.1, *) {
            reservedRegionsSupported = true
            reservedRegionEntries += serializeReservedRegions(
                for: reservedRegions(kind: .division, options: .includeInactive),
                kind: "division",
                in: window,
            )
            reservedRegionEntries += serializeReservedRegions(
                for: reservedRegions(kind: .occlusion, options: .includeInactive),
                kind: "occlusion",
                in: window,
            )
        }

        var payload: [String: Any] = [
            "hasHinge": hasHinge,
            // Keep the physical window domain distinct from a nested or safe-area-contracted sensor.
            "windowBounds": rectPayload(window.bounds),
            "viewportBounds": rectPayload(convert(bounds, to: window)),
            "safeAreaInsets": insetsPayload(window.safeAreaInsets),
            "reservedRegionsSupported": reservedRegionsSupported,
            "reservedRegions": reservedRegionEntries,
        ]
        if let navigationWidth {
            payload["navigationWidth"] = navigationWidth
        }
        if let navigationFrame {
            payload["navigationFrame"] = navigationFrame
        }
        return payload
    }

    @available(iOS 27.1, *)
    private func serializeReservedRegions(
        for regions: [UIView.ReservedRegion],
        kind: String,
        in window: UIWindow,
    ) -> [[String: Any]] {
        regions.map { region in
            [
                "id": String(describing: region.id),
                "kind": kind,
                "frame": rectPayload(window.convert(region.frame, from: self)),
                "margins": insetsPayload(region.margins),
                "isActive": region.isActive,
            ]
        }
    }

    private func rectPayload(_ rect: CGRect) -> [String: Double] {
        [
            "x": Double(rect.minX),
            "y": Double(rect.minY),
            "width": Double(rect.width),
            "height": Double(rect.height),
        ]
    }

    private func insetsPayload(_ insets: UIEdgeInsets) -> [String: Double] {
        [
            "top": Double(insets.top),
            "right": Double(insets.right),
            "bottom": Double(insets.bottom),
            "left": Double(insets.left),
        ]
    }
}

@objc(NavigationGeometryViewManager)
final class NavigationGeometryViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        NavigationGeometryView(frame: .zero)
    }
}

/// Sends only physical control geometry; a sensor ignores notifications from other windows.
enum NavigationSurfaceGeometry {
    static func publish(_ view: UIView, side: String, actions: [NavigationActionDescriptor]) {
        // Primary-only bottom actions do not replace the side navigation's measured frame.
        guard actions.contains(where: { $0.rootTab || $0.id == "back" || $0.id == "home" }) else { return }
        var ancestor: UIView? = view
        while let current = ancestor {
            guard !current.isHidden, current.alpha > 0.01 else { return }
            ancestor = current.superview
        }
        guard !view.isHidden, let window = view.window, !view.bounds.isEmpty else { return }
        let frame = view.convert(view.bounds, to: window)
        NotificationCenter.default.post(name: Notification.Name("OrotNavigationSurfaceGeometryDidChange"),
                                        object: view, userInfo: ["side": side, "frame": [
                                            "x": Double(frame.minX), "y": Double(frame.minY),
                                            "width": Double(frame.width), "height": Double(frame.height),
                                        ]])
    }
}
