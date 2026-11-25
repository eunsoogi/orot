import React
import UIKit

/// Reports the edge-to-edge navigation window geometry without participating in touch handling.
final class NavigationGeometryView: UIView {
    @objc var onGeometryChange: RCTDirectEventBlock? {
        didSet { publishGeometryIfNeeded() }
    }

    private var lastSnapshotData: Data?
    private var hasHinge = false
    private var navigationSide: String?
    private var navigationWidth: Double?
    private var navigationFrame: [String: Double]?

    private var keyboardScreenFrame: CGRect?

    /// Observe public hinge identity and the actual mounted controls, without inspecting route contents.
    private func observeWindowGeometry() {
        NotificationCenter.default.addObserver(self, selector: #selector(navigationFrameChanged),
                                               name: Notification.Name("OrotNavigationSurfaceGeometryDidChange"), object: nil)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardFrameChanged), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardFrameChanged), name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardFrameChanged), name: UIResponder.keyboardWillHideNotification, object: nil)
        if #available(iOS 27.1, *) {
            registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge, action: #selector(setNeedsLayout))
            addInteraction(UIHingeInteraction { [weak self] _, update in
                guard let self else { return }
                hasHinge = update.hinge != nil
                publishGeometryIfNeeded()
            })
        }
    }

    /// Keep screen coordinates until publication so split-window offsets are converted by UIKit.
    @objc private func keyboardFrameChanged(_ notification: Notification) {
        guard let window, let screen = window.windowScene?.screen,
              (notification.object as? UIScreen).map({ $0 === screen }) ?? true,
              (notification.userInfo?[UIResponder.keyboardIsLocalUserInfoKey] as? Bool) != false else { return }
        if notification.name == UIResponder.keyboardWillHideNotification {
            keyboardScreenFrame = nil
        } else {
            guard window.isKeyWindow,
                  let value = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
            keyboardScreenFrame = value.cgRectValue
        }
        publishGeometryIfNeeded()
    }

    private func dockedKeyboardFrame(in window: UIWindow) -> CGRect? {
        guard let screen = window.windowScene?.screen, let keyboardScreenFrame else { return nil }
        let frame = window.convert(keyboardScreenFrame, from: screen.coordinateSpace)
        guard [frame.minX, frame.minY, frame.width, frame.height].allSatisfy(\.isFinite),
              frame.maxY + 1 >= window.bounds.maxY,
              frame.minY > window.bounds.minY else { return nil }
        let overlap = frame.intersection(window.bounds)
        return overlap.isEmpty ? nil : overlap
    }

    @objc private func navigationFrameChanged(_ notification: Notification) {
        #if OROT_TESTS
            // Separate sender activity from same-window acceptance without altering notification delivery.
            let sameWindow = (notification.object as? UIView).map { $0.window != nil && $0.window === window } ?? false
            TestLifecycleObservation.record("navigation-frame-received", fields: ["sameWindow": sameWindow, "frame": notification.userInfo?["frame"] ?? [:]])
        #endif
        guard let source = notification.object as? UIView, source.window === window,
              let frame = notification.userInfo?["frame"] as? [String: Double] else { return }
        navigationFrame = frame
        navigationSide = notification.userInfo?["side"] as? String
        navigationWidth = navigationSide == "bottom" ? nil : frame["width"]
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
        keyboardScreenFrame = nil
        navigationFrame = nil
        navigationWidth = nil
        navigationSide = nil
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
        if let frame = dockedKeyboardFrame(in: window) {
            payload["dockedKeyboardFrame"] = rectPayload(frame)
        }
        if let navigationWidth {
            payload["navigationWidth"] = navigationWidth
        }
        if let navigationFrame {
            payload["navigationFrame"] = navigationFrame
        }
        if let navigationSide {
            payload["navigationSide"] = navigationSide
        }
        if let frame = systemTopBarFrame(in: window) {
            payload["systemTopBarFrame"] = rectPayload(frame)
        }
        return payload
    }

    private func systemTopBarFrame(in window: UIWindow) -> CGRect? {
        if #available(iOS 27.1, *), window.traitCollection.verticalBarEdge != .unspecified {
            return nil
        }
        guard let scene = window.windowScene, let manager = scene.statusBarManager else { return nil }
        guard !manager.isStatusBarHidden else { return nil }
        let sceneSpace: any UICoordinateSpace = if #available(iOS 26.0, *) {
            scene.effectiveGeometry.coordinateSpace
        } else {
            scene.coordinateSpace
        }
        let frame = window.convert(manager.statusBarFrame, from: sceneSpace)
        guard !frame.isEmpty, frame.width > frame.height else { return nil }
        guard [frame.minX, frame.minY, frame.width, frame.height].allSatisfy(\.isFinite) else { return nil }
        return frame
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
