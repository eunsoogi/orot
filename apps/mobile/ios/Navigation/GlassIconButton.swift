import React
import UIKit

/// A standard UIKit glass control owns highlighting, disabled state and the accessible hit target.
final class GlassIconButton: UIButton {
    /// Shrink the visible material and glyph only; UIButton keeps its full accessible bounds.
    @objc var visualScale: CGFloat = 1 {
        didSet { configure() }
    }

    private var configuredSize = CGSize.zero

    override func layoutSubviews() {
        if configuredSize != bounds.size {
            configure()
        }
        super.layoutSubviews()
    }

    @objc var symbolName = "" {
        didSet { configure() }
    }

    @objc var actionLabel = "" {
        didSet { accessibilityLabel = actionLabel }
    }

    @objc var actionHint = "" {
        didSet { accessibilityHint = actionHint.isEmpty ? nil : actionHint }
    }

    @objc var actionTestID = "" {
        didSet { accessibilityIdentifier = actionTestID }
    }

    @objc var disabled = false {
        didSet { isEnabled = !disabled }
    }

    @objc var busy = false {
        didSet { accessibilityValue = busy ? NSLocalizedString("action.busy", tableName: "NativeInterfaceCopy", comment: "Accessible busy state") : nil }
    }

    @objc var onGlassIconPress: RCTDirectEventBlock?

    override init(frame: CGRect) {
        super.init(frame: frame)
        // A directly initialized UIButton subclass must expose its own accessible action.
        isAccessibilityElement = true
        addAction(UIAction { [weak self] _ in
            guard let self, isEnabled else { return }
            onGlassIconPress?([:])
        }, for: .touchUpInside)
        configure()
        NotificationCenter.default.addObserver(self, selector: #selector(configure),
                                               name: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("Created by its view manager")
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    /// Use system configuration rather than a passive effect below a separately implemented button.
    /// A filled system fallback is intentionally opaque when transparency is disabled or unavailable.
    @objc private func configure() {
        configuredSize = bounds.size
        let scale = visualScale.isFinite ? max(0.5, min(1, visualScale)) : 1
        var config: UIButton.Configuration
        if #available(iOS 26.0, *), !UIAccessibility.isReduceTransparencyEnabled {
            config = .glass()
        } else {
            config = .filled()
            config.baseBackgroundColor = .secondarySystemBackground
        }
        config.background.backgroundInsets = NSDirectionalEdgeInsets(
            top: bounds.height * (1 - scale) / 2, leading: bounds.width * (1 - scale) / 2,
            bottom: bounds.height * (1 - scale) / 2, trailing: bounds.width * (1 - scale) / 2,
        )
        config.cornerStyle = .capsule
        config.contentInsets = .zero
        config.baseForegroundColor = .label
        config.image = UIImage(systemName: symbolName, withConfiguration: AppSymbolSizing.configuration(pointSize: AppSymbolSizing.compactPointSize * scale))
        configuration = config
        isEnabled = !disabled
    }
}

@objc(GlassIconButtonManager)
final class GlassIconButtonManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        GlassIconButton(frame: .zero)
    }
}
