import React
import UIKit

/// Reports the edge-to-edge navigation window geometry without participating in touch handling.
final class NavigationGeometryView: UIView {
    @objc var onGeometryChange: RCTDirectEventBlock? {
        didSet { publishGeometryIfNeeded() }
    }

    private var lastSnapshotData: Data?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        backgroundColor = .clear
        isOpaque = false
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

        return [
            "windowBounds": rectPayload(convert(bounds, to: window)),
            "safeAreaInsets": insetsPayload(safeAreaInsets),
            "reservedRegionsSupported": reservedRegionsSupported,
            "reservedRegions": reservedRegionEntries,
        ]
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
