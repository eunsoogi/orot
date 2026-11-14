import React
import UIKit

/// A standard UIKit glass control owns highlighting, disabled state and the accessible hit target.
final class GlassIconButton: UIButton {
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
        didSet { accessibilityValue = busy ? "진행 중" : nil }
    }

    @objc var onAction: RCTDirectEventBlock?

    override init(frame: CGRect) {
        super.init(frame: frame)
        addAction(UIAction { [weak self] _ in
            guard let self, isEnabled else { return }
            onAction?([:])
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
        var config: UIButton.Configuration
        if #available(iOS 26.0, *), !UIAccessibility.isReduceTransparencyEnabled {
            config = .glass()
        } else {
            config = .filled()
            config.baseBackgroundColor = .secondarySystemBackground
        }
        config.cornerStyle = .capsule
        config.contentInsets = .zero
        config.baseForegroundColor = .label
        config.image = UIImage(systemName: symbolName, withConfiguration: AppSymbolSizing.configuration())
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
