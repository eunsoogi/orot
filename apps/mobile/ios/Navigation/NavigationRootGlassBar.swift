import UIKit

/** Cross-fades native navigation action updates and honors Reduce Motion. */
enum NavigationToolbarTransition {
    static func apply(to view: UIView, animated: Bool, changes: @escaping () -> Void) {
        guard animated, !UIAccessibility.isReduceMotionEnabled else {
            changes()
            return
        }

        UIView.transition(
            with: view,
            duration: 0.14,
            options: [.transitionCrossDissolve, .beginFromCurrentState, .allowAnimatedContent, .allowUserInteraction],
            animations: changes,
        )
    }
}

/// Preserves one joined Glass surface and moving selection while switching between bottom and side layouts.
final class NavigationRootGlassBar: UIVisualEffectView {
    static let exteriorWidth: CGFloat = 48
    /// Five 52pt targets plus four 4pt gaps keep rail buttons the same size as bottom targets.
    static let railHeight: CGFloat = 276
    /// The common Back target plus its clear gap sit above the fixed five-tab surface.
    static let contextualBackGroupHeight: CGFloat = 52

    private let stack = UIStackView()
    private let indicator = UIView()
    private var descriptors: [NavigationActionDescriptor] = []
    private var buttons: [UIButton] = []
    private var usesVerticalLayout = false

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
                        // Filled and outline symbols share the compact scale while selection keeps its existing tint.
                        icon.image = UIImage(systemName: symbolName, withConfiguration: AppSymbolSizing.configuration())
                        icon.tintColor = color
                    }
                    if let label = child as? UILabel {
                        label.text = action.label
                        label.font = NavigationTextMetrics.font(for: action, traits: button.traitCollection)
                        label.textColor = color
                        label.isHidden = usesVerticalLayout
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

    /// Keeps measured bottom targets tall enough for uncapped Dynamic Type labels.
    func setBottomHeight(_ height: CGFloat) {
        for (button, action) in zip(buttons, descriptors) {
            NavigationGlassButton.setHeight(height, for: action, button: button, usesRightRail: usesVerticalLayout)
        }
    }

    /// Hides only visible tab titles in the narrow lane; button accessibility names remain unchanged.
    func setVerticalLayout(_ isVertical: Bool) {
        guard usesVerticalLayout != isVertical else { return }
        usesVerticalLayout = isVertical
        stack.axis = isVertical ? .vertical : .horizontal
        layer.cornerRadius = isVertical ? Self.exteriorWidth / 2 : 30
        for (button, action) in zip(buttons, descriptors) where action.rootTab {
            for content in button.subviews.compactMap({ $0 as? UIStackView }) {
                content.arrangedSubviews.compactMap { $0 as? UILabel }.forEach {
                    $0.isHidden = isVertical
                }
            }
        }
        setNeedsLayout()
        layoutIfNeeded()
    }

    private var selectedFrame: CGRect? {
        guard let index = descriptors.firstIndex(where: \.selected), buttons.indices.contains(index) else { return nil }
        guard buttons[index].bounds.width > 0, buttons[index].bounds.height > 0 else { return nil }
        let buttonFrame = buttons[index].convert(buttons[index].bounds, to: contentView)
        // The visual selection is a centered circle; the original rectangular hit target remains unchanged.
        let diameter = max(0, min(buttonFrame.width, buttonFrame.height) - 4)
        return CGRect(x: buttonFrame.midX - diameter / 2, y: buttonFrame.midY - diameter / 2,
                      width: diameter, height: diameter)
    }

    private func moveIndicator(animated: Bool) {
        guard let frame = selectedFrame else { indicator.isHidden = true; return }
        indicator.isHidden = false
        indicator.layer.cornerRadius = frame.width / 2
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

/// Reconciles contextual controls beside the root material without replacing stable Back buttons.
extension NavigationGlassSurfaceView {
    func renderInnerActions(_ descriptors: [NavigationActionDescriptor], onAction: @escaping (String) -> Void) {
        let back = descriptors.first { $0.id == "back" }
        let actions = descriptors.filter { $0.id != "back" }
        let desiredIDs = Set(descriptors.map(\.id))
        let removedIDs = contextualButtons.keys.filter { !desiredIDs.contains($0) }
        for id in removedIDs {
            guard let button = contextualButtons.removeValue(forKey: id) else { continue }
            innerActions.removeArrangedSubview(button)
            button.removeFromSuperview()
            contextualButtonWidthConstraints.removeValue(forKey: id)?.isActive = false
            contextualButtonFixedWidthConstraints.removeValue(forKey: id)?.isActive = false
        }

        for action in descriptors {
            let button: UIButton
            if let existing = contextualButtons[action.id] {
                button = existing
                NavigationGlassButton.update(button, for: action)
            } else {
                button = NavigationGlassButton.make(for: action, onAction: onAction)
                contextualButtons[action.id] = button
            }
            NavigationGlassButton.updateMinimumWidth(for: action, button: button, usesRightRail: layoutMode != "bottom", constraints: &contextualButtonWidthConstraints)
            NavigationRailConstraints.updateFixedWidth(for: action, button: button, usesRightRail: layoutMode != "bottom", constraints: &contextualButtonFixedWidthConstraints)
            NavigationGlassButton.setHeight(bottomHeight, for: action, button: button, usesRightRail: layoutMode != "bottom")
        }

        var orderedViews: [UIView] = []
        if let back, let button = contextualButtons[back.id] {
            orderedViews.append(button)
        }
        orderedViews.append(innerActionsSpacer)
        orderedViews.append(contentsOf: actions.compactMap { contextualButtons[$0.id] })
        for (index, view) in orderedViews.enumerated() {
            if innerActions.arrangedSubviews.indices.contains(index),
               innerActions.arrangedSubviews[index] === view
            {
                continue
            }
            if innerActions.arrangedSubviews.contains(where: { $0 === view }) {
                innerActions.removeArrangedSubview(view)
            }
            innerActions.insertArrangedSubview(view, at: index)
        }
    }
}
