import UIKit

/// One joined 60pt glass surface with 52pt root targets and a moving selection view.
final class NavigationRootGlassBar: UIVisualEffectView {
    private let stack = UIStackView()
    private let indicator = UIView()
    private var descriptors: [NavigationActionDescriptor] = []
    private var buttons: [UIButton] = []

    init() {
        let material: UIVisualEffect
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.isInteractive = false
            material = glass
        } else {
            material = UIBlurEffect(style: .systemMaterial)
        }
        super.init(effect: material)
        accessibilityIdentifier = "navigation-root-tabs-glass-backdrop"
        layer.cornerRadius = 30
        layer.cornerCurve = .continuous
        clipsToBounds = true
        indicator.accessibilityIdentifier = "navigation-root-selection-indicator"
        indicator.isUserInteractionEnabled = false
        indicator.backgroundColor = NavigationGlassPalette.selectedRootTabBackground
        indicator.layer.cornerRadius = 24
        contentView.addSubview(indicator)
        stack.axis = .horizontal
        // Center the 52pt hit targets in the 60pt material surface with 4pt vertical margins.
        stack.alignment = .center
        stack.distribution = .fillEqually
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(motionPreferenceChanged),
                                               name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func render(_ actions: [NavigationActionDescriptor], animated: Bool, onAction: @escaping (String) -> Void) {
        let compositionChanged = descriptors.map(\.id) != actions.map(\.id)
        descriptors = actions
        if compositionChanged {
            for arrangedSubview in stack.arrangedSubviews {
                stack.removeArrangedSubview(arrangedSubview)
                arrangedSubview.removeFromSuperview()
            }
            buttons = actions.map { NavigationGlassButton.make(for: $0, onAction: onAction) }
            buttons.forEach(stack.addArrangedSubview)
        }
        for (button, action) in zip(buttons, actions) {
            button.isEnabled = !action.disabled
            button.isSelected = action.selected
            button.accessibilityLabel = action.accessibilityLabel
            // Custom traits replace UIKit defaults, so disabled root tabs need the explicit trait too.
            var traits: UIAccessibilityTraits = action.selected ? [.button, .selected] : [.button]
            if action.disabled {
                traits.insert(.notEnabled)
            }
            button.accessibilityTraits = traits
            let color = action.selected ? NavigationGlassPalette.selectedRootTabForeground : UIColor.label
            button.tintColor = color
            for content in button.subviews.compactMap({ $0 as? UIStackView }) {
                for child in content.arrangedSubviews {
                    if let icon = child as? UIImageView, let symbolName = action.systemImageName {
                        // Filled and outline symbols change with selection even though button identity stays stable.
                        icon.image = UIImage(systemName: symbolName, withConfiguration: UIImage.SymbolConfiguration(
                            pointSize: 22, weight: .medium,
                        ))
                        icon.tintColor = color
                    }
                    if let label = child as? UILabel {
                        label.text = action.label
                        label.textColor = color
                    }
                }
            }
        }
        // Resolve target geometry but preserve the presentation frame when rapid taps interrupt a move.
        stack.layoutIfNeeded()
        moveIndicator(animated: animated && !compositionChanged)
        // React Native may deliver actions before Auto Layout resolves the new button frames.
        setNeedsLayout()
    }

    private var selectedFrame: CGRect? {
        guard let index = descriptors.firstIndex(where: \.selected), buttons.indices.contains(index) else { return nil }
        guard buttons[index].bounds.width > 0, buttons[index].bounds.height > 0 else { return nil }
        return buttons[index].convert(buttons[index].bounds, to: contentView).insetBy(dx: 2, dy: 2)
    }

    private func moveIndicator(animated: Bool) {
        guard let frame = selectedFrame else { indicator.isHidden = true; return }
        indicator.isHidden = false
        guard animated, !UIAccessibility.isReduceMotionEnabled, !indicator.frame.isEmpty else {
            indicator.layer.removeAllAnimations()
            indicator.frame = frame
            return
        }
        UIView.animate(withDuration: 0.24, delay: 0,
                       options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut])
        {
            self.indicator.frame = frame
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        stack.layoutIfNeeded()
        // Compare final target geometry, not only bar size: initial child layout can arrive later.
        // The model frame already equals the destination during animation, so this preserves its presentation path.
        if let target = selectedFrame, indicator.isHidden || indicator.frame != target {
            moveIndicator(animated: false)
        }
    }

    @objc private func motionPreferenceChanged() {
        if UIAccessibility.isReduceMotionEnabled {
            moveIndicator(animated: false)
        }
    }
}
