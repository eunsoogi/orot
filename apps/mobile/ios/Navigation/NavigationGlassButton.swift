import UIKit

/// Builds native controls while keeping persistent selection exclusive to root tabs.
enum NavigationGlassButton {
    /// Keeps contextual controls at their shipping sizes except for the compact rail Home target.
    static func fixedWidth(for action: NavigationActionDescriptor, usesRightRail: Bool) -> CGFloat? {
        switch action.id {
        case "back":
            NavigationRootGlassBar.exteriorWidth
        case "home":
            usesRightRail ? NavigationRootGlassBar.exteriorWidth : 64
        default:
            nil
        }
    }

    /// Hides only Home's visible title in the rail; the button keeps its VoiceOver name.
    static func setUsesRightRail(_ usesRightRail: Bool, for action: NavigationActionDescriptor, button: UIButton) {
        guard action.id == "home" else { return }
        for content in button.subviews.compactMap({ $0 as? UIStackView }) {
            content.arrangedSubviews.compactMap { $0 as? UILabel }.forEach {
                $0.isHidden = usesRightRail
            }
        }
    }

    /// Tracks localized primary titles while keeping one width constraint per stable action.
    static func updateMinimumWidth(for action: NavigationActionDescriptor, button: UIButton, constraints: inout [String: NSLayoutConstraint]) {
        guard action.id != "home", action.id != "back" else { return }
        let titleWidth = (action.label as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 14)]).width
        let minimumWidth = max(88, titleWidth + 24)
        if let constraint = constraints[action.id] {
            constraint.constant = minimumWidth
        } else {
            let constraint = button.widthAnchor.constraint(greaterThanOrEqualToConstant: minimumWidth)
            constraint.isActive = true
            constraints[action.id] = constraint
        }
    }

    /// Creates a UIKit control once for a stable navigation action ID.
    static func make(for action: NavigationActionDescriptor, onAction: @escaping (String) -> Void) -> UIButton {
        let button = UIButton(type: .system)
        configure(button, for: action)
        button.translatesAutoresizingMaskIntoConstraints = false
        let height: CGFloat = action.rootTab ? 52 : 48
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: height),
        ])
        if action.id == "back" {
            NavigationBackContent.attach(to: button, testID: action.testID)
        }
        if action.rootTab || action.id == "home", let name = action.systemImageName {
            let content = NavigationRootTabContent.make(
                label: action.label,
                symbolName: name,
                testID: action.testID,
                foregroundColor: action.rootTab && action.selected ? NavigationGlassPalette.selectedRootTabForeground : .label,
                titleSize: action.rootTab ? 12 : 11,
            )
            button.addSubview(content)
            NSLayoutConstraint.activate([
                content.centerXAnchor.constraint(equalTo: button.centerXAnchor),
                content.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            ])
        }
        button.addAction(UIAction(title: action.label) { _ in
            // Dispatch follows the immutable action ID captured when the control is created.
            onAction(action.id)
        }, for: .touchUpInside)

        return button
    }

    /// Updates a mounted control in place so UIKit keeps its active touch and Glass view identity.
    static func update(_ button: UIButton, for action: NavigationActionDescriptor) {
        configure(button, for: action)
        if action.id == "back" {
            button.subviews.compactMap { $0 as? UIImageView }.forEach {
                $0.accessibilityIdentifier = "\(action.testID)-UIImageView"
            }
        }
        if action.rootTab || action.id == "home" {
            for content in button.subviews.compactMap({ $0 as? UIStackView }) {
                for child in content.arrangedSubviews {
                    if let icon = child as? UIImageView, let name = action.systemImageName {
                        icon.image = UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(
                            pointSize: 22, weight: .medium,
                        ))
                        icon.tintColor = action.rootTab && action.selected ? NavigationGlassPalette.selectedRootTabForeground : .label
                        icon.accessibilityIdentifier = "\(action.testID)-UIImageView"
                    }
                    if let label = child as? UILabel {
                        label.text = action.label
                        label.textColor = action.rootTab && action.selected ? NavigationGlassPalette.selectedRootTabForeground : .label
                        label.accessibilityIdentifier = "\(action.testID)-UILabel"
                    }
                }
            }
        }
    }

    /// Reapplies descriptor-driven configuration without replacing the mounted UIButton.
    private static func configure(_ button: UIButton, for action: NavigationActionDescriptor) {
        let selectedRootTab = action.rootTab && action.selected
        var configuration: UIButton.Configuration = if action.rootTab {
            .plain()
        } else if #available(iOS 26.0, *) {
            // Back and Home keep separate regular Glass surfaces; only the task action uses prominent Glass.
            action.primary ? .prominentGlass() : action.id == "back" || action.id == "home" ? .glass() : .plain()
        } else {
            action.primary ? .filled() : .plain()
        }
        if action.rootTab {
            // Selection is drawn once by the moving bar indicator, never by UIButton's automatic selected fill.
            configuration.background = .clear()
        }
        if action.rootTab || action.id == "home" || action.id == "back" {
            // Bound native symbols and labels independently from each button's target size.
            configuration.title = nil
            configuration.image = nil
            configuration.contentInsets = .zero
        } else {
            configuration.title =
                action.systemImageName == nil || action.showsTitleWithSystemImage
                    ? action.label
                    : nil
            if let name = action.systemImageName {
                configuration.image = UIImage(
                    systemName: name,
                    withConfiguration: UIImage.SymbolConfiguration(
                        pointSize: 24,
                        weight: .semibold,
                    ),
                )
            }
            configuration.imagePlacement = action.titleBelowImage ? .top : .leading
            configuration.imagePadding = action.showsTitleWithSystemImage ? 2 : 6
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var updated = attributes
                // Match the shipping toolbar's readable title size without clipping localized text.
                let titleSize: CGFloat = action.titleBelowImage ? 10 : 14
                updated.font = .systemFont(ofSize: titleSize, weight: .medium)
                return updated
            }
            configuration.contentInsets = NSDirectionalEdgeInsets(
                top: action.showsTitleWithSystemImage ? 5 : 12,
                leading: action.showsTitleWithSystemImage ? 5 : 12,
                bottom: action.showsTitleWithSystemImage ? 5 : 12,
                trailing: action.showsTitleWithSystemImage ? 5 : 12,
            )
        }
        configuration.baseForegroundColor = action.primary
            ? .white
            : selectedRootTab
            ? NavigationGlassPalette.selectedRootTabForeground
            : .label
        button.configuration = configuration
        // Root selection has its own moving surface; UIKit's automatic selected fill would duplicate it.
        if action.rootTab {
            button.automaticallyUpdatesConfiguration = false
        }
        button.accessibilityLabel = action.accessibilityLabel
        button.accessibilityIdentifier = action.testID
        button.isEnabled = !action.disabled
        button.isSelected = selectedRootTab
        button.tintColor =
            action.primary
                ? NavigationGlassPalette.primaryTint
                : selectedRootTab
                ? NavigationGlassPalette.selectedRootTabForeground
                : UIColor.label
        // Custom traits replace UIKit's defaults, so mirror disabled state for accessibility clients.
        var accessibilityTraits: UIAccessibilityTraits = [.button]
        if selectedRootTab {
            accessibilityTraits.insert(.selected)
        }
        if action.disabled {
            accessibilityTraits.insert(.notEnabled)
        }
        button.accessibilityTraits = accessibilityTraits
    }
}
