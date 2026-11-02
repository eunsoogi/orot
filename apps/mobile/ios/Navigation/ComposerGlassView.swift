import React
import UIKit

/// A material-only backing keeps React's text input, focus and actions in their own hierarchy.
/// It never consumes touches or becomes an accessibility element.
final class ComposerGlassSurfaceView: UIVisualEffectView {
    init() {
        let material: UIVisualEffect = if #available(iOS 26.0, *) {
            UIGlassEffect(style: .regular)
        } else {
            UIBlurEffect(style: .systemMaterial)
        }
        super.init(effect: material)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        layer.cornerCurve = .continuous
        clipsToBounds = true
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

/// UIKit lays out the material and action together; React overlays its editable text in the input region.
/// Keeping Glass children native avoids legacy interop reparenting their frames to zero.
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
    private let inputMaterial = ComposerGlassSurfaceView()
    private let group: UIVisualEffectView

    override init(frame: CGRect) {
        let effect: UIVisualEffect? = if #available(iOS 26.0, *) {
            { let value = UIGlassContainerEffect(); value.spacing = 6; return value }()
        } else {
            nil
        }
        group = UIVisualEffectView(effect: effect)
        super.init(frame: frame)
        backgroundColor = .clear
        isAccessibilityElement = false
        group.frame = bounds
        group.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(group)
        inputMaterial.translatesAutoresizingMaskIntoConstraints = false
        button.translatesAutoresizingMaskIntoConstraints = false
        group.contentView.addSubview(inputMaterial)
        group.contentView.addSubview(button)
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
        // These 44pt action / 8pt gap dimensions match React's reserved action slot.
        NSLayoutConstraint.activate([
            button.trailingAnchor.constraint(equalTo: group.contentView.trailingAnchor),
            button.bottomAnchor.constraint(equalTo: group.contentView.bottomAnchor),
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44),
            icon.widthAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
            icon.heightAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
            icon.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            inputMaterial.leadingAnchor.constraint(equalTo: group.contentView.leadingAnchor),
            inputMaterial.topAnchor.constraint(equalTo: group.contentView.topAnchor),
            inputMaterial.bottomAnchor.constraint(equalTo: group.contentView.bottomAnchor),
            inputMaterial.trailingAnchor.constraint(equalTo: button.leadingAnchor, constant: -8),
        ])
        button.addAction(UIAction { [weak self] _ in self?.onComposerPress?([:]) }, for: .touchUpInside)
        update()
    }

    /// The material is transparent to touches; only the native action consumes them.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit is UIControl ? hit : nil
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("Created by its view manager")
    }

    private func update() {
        var configuration: UIButton.Configuration = if #available(iOS 26.0, *) {
            .glass()
        } else {
            .gray()
        }
        configuration.cornerStyle = .capsule
        configuration.contentInsets = .zero
        configuration.image = nil
        // Keep the rendered glyph in the shared 18pt aspect-fit canvas, independent of the button target.
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
