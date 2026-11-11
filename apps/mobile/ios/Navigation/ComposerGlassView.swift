import React
import UIKit

/// A material-only backing keeps React's text input, focus and actions in their own hierarchy.
/// It never consumes touches or becomes an accessibility element.
final class ComposerGlassSurfaceView: UIVisualEffectView {
    init() {
        super.init(effect: nil)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        layer.cornerCurve = .continuous
        clipsToBounds = true
        updateMaterial(reduceTransparencyEnabled: UIAccessibility.isReduceTransparencyEnabled)
        NotificationCenter.default.addObserver(self, selector: #selector(reduceTransparencyPreferenceChanged),
                                               name: UIAccessibility.reduceTransparencyStatusDidChangeNotification,
                                               object: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("ComposerGlassSurfaceView is created by its view manager")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Multiline input grows vertically while keeping the same rounded capsule ends.
        layer.cornerRadius = min(28, bounds.height / 2)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /// Reduced Transparency replaces translucent effects with a dynamic, opaque system surface.
    func updateMaterial(reduceTransparencyEnabled: Bool) {
        guard !reduceTransparencyEnabled else {
            effect = nil
            backgroundColor = .secondarySystemBackground
            return
        }

        backgroundColor = .clear
        if #available(iOS 26.0, *) {
            effect = UIGlassEffect(style: .regular)
        } else {
            effect = UIBlurEffect(style: .systemMaterial)
        }
    }

    /// Applies accessibility changes after UIKit broadcasts a Reduce Transparency setting update.
    @objc private func reduceTransparencyPreferenceChanged() {
        updateMaterial(reduceTransparencyEnabled: UIAccessibility.isReduceTransparencyEnabled)
    }
}

@objc(ComposerGlassViewManager)
final class ComposerGlassViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        ComposerGlassSurfaceView()
    }
}

/// A pass-through host keeps the native action aligned with the trailing edge of React's growing field.
final class ComposerGlassActionView: UIView {
    @objc var busy = false {
        didSet { update() }
    }

    @objc var disabled = false {
        didSet { update() }
    }

    @objc var actionLabel = "" {
        didSet { update() }
    }

    @objc var actionTestID = "" {
        didSet { update() }
    }

    // React Native shares event types across managers; topPress is already a bubbling event.
    @objc var onComposerPress: RCTDirectEventBlock?
    private let button = UIButton(type: .system)
    private let icon = UIImageView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isAccessibilityElement = false
        button.translatesAutoresizingMaskIntoConstraints = false
        button.backgroundColor = .clear
        addSubview(button)
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.contentMode = .scaleAspectFit
        icon.tintColor = .label
        icon.isUserInteractionEnabled = false
        icon.isAccessibilityElement = false
        button.addSubview(icon)
        button.tintColor = .label
        // The display canvas is outside UIButton.Configuration's image view, so mirror its state tint.
        button.configurationUpdateHandler = { [weak self] button in
            self?.updateIconTint(for: button)
        }
        // Keep the action at 44pt while anchoring it to the bottom-right of the multiline field.
        NSLayoutConstraint.activate([
            button.trailingAnchor.constraint(equalTo: trailingAnchor),
            button.bottomAnchor.constraint(equalTo: bottomAnchor),
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44),
            icon.widthAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
            icon.heightAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
            icon.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: button.centerYAnchor),
        ])
        button.addAction(UIAction { [weak self] _ in self?.onComposerPress?([:]) }, for: .touchUpInside)
        update()
    }

    /// The overlay consumes only button touches, letting other input gestures reach React's text field.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit is UIControl ? hit : nil
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("Created by its view manager")
    }

    private func update() {
        var configuration = UIButton.Configuration.plain()
        configuration.contentInsets = .zero
        configuration.image = nil
        // Keep one uninterrupted field material behind the icon instead of layering a second Glass button.
        icon.image = UIImage(
            systemName: busy ? "stop.fill" : "arrow.up",
            withConfiguration: AppSymbolSizing.configuration(),
        )
        button.configuration = configuration
        button.isEnabled = !disabled
        button.accessibilityLabel = actionLabel
        button.accessibilityIdentifier = actionTestID
        updateIconTint(for: button)
    }

    /// Uses UIKit's state-updated foreground color for the custom constrained symbol view.
    private func updateIconTint(for button: UIButton) {
        let stateConfiguration = button.configuration?.updated(for: button)
        let baseTint = stateConfiguration?.baseForegroundColor ?? button.tintColor ?? .label
        icon.tintColor = stateConfiguration?.imageColorTransformer?(baseTint) ?? baseTint
    }
}

@objc(ComposerGlassActionViewManager)
final class ComposerGlassActionViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        ComposerGlassActionView()
    }
}
