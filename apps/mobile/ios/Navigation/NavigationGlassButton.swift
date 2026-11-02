import UIKit

/// Builds native controls while keeping persistent selection exclusive to root tabs.
enum NavigationGlassButton {
    /// The measured bottom height grows with text; rail targets keep their existing size.
    static func setHeight(_ height: CGFloat, for action: NavigationActionDescriptor, button: UIButton, usesRightRail: Bool) {
        let target = usesRightRail ? (action.rootTab ? 52 : 48) : max(action.rootTab ? 52 : 48, height - (action.rootTab ? 8 : 0))
        button.constraints.first { $0.identifier == "navigation-control-height" }?.constant = target
    }

    /// Keeps contextual controls at their shipping sizes except for the compact rail Home target.
    static func fixedWidth(for action: NavigationActionDescriptor, usesRightRail: Bool, traits: UITraitCollection) -> CGFloat? {
        // Page actions use icons and the same lane width as navigation on the rail.
        if usesRightRail, action.id.hasPrefix("page:") {
            return NavigationRootGlassBar.exteriorWidth
        }
        return switch action.id {
        case "back":
            usesRightRail ? NavigationRootGlassBar.exteriorWidth : NavigationTextMetrics.width(for: action, traits: traits)
        case "home":
            usesRightRail ? NavigationRootGlassBar.exteriorWidth : NavigationTextMetrics.width(for: action, traits: traits)
        default:
            nil
        }
    }

    /// The narrow rail hides visible navigation titles but retains VoiceOver names.
    static func setUsesRightRail(_ usesRightRail: Bool, for action: NavigationActionDescriptor, button: UIButton) {
        guard action.id == "home" || action.id == "back" else { return }
        for content in button.subviews.compactMap({ $0 as? UIStackView }) {
            content.arrangedSubviews.compactMap { $0 as? UILabel }.forEach {
                $0.isHidden = usesRightRail
            }
        }
    }

    /// Tracks localized primary titles while keeping one width constraint per stable action.
    static func updateMinimumWidth(for action: NavigationActionDescriptor, button: UIButton, usesRightRail: Bool, constraints: inout [String: NSLayoutConstraint]) {
        guard action.id != "home", action.id != "back" else { return }
        let compactPageAction = action.id == "page:overflow" || (usesRightRail && action.id.hasPrefix("page:"))
        let minimumWidth = usesRightRail && compactPageAction ? 44 : NavigationTextMetrics.width(for: action, traits: button.traitCollection)
        if let constraint = constraints[action.id] {
            constraint.constant = minimumWidth
        } else {
            let constraint = button.widthAnchor.constraint(greaterThanOrEqualToConstant: minimumWidth)
            // Measurements can arrive after a resize; allow temporary compression instead of conflicting constraints.
            if action.id.hasPrefix("page:") {
                constraint.priority = .defaultHigh
            }
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
        let heightConstraint = button.heightAnchor.constraint(equalToConstant: height)
        heightConstraint.identifier = "navigation-control-height"
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            heightConstraint,
        ])
        let symbolName = action.systemImageName ?? (action.id == "back" ? "chevron.backward" : nil)
        if action.rootTab || action.id == "home" || action.id == "back", let name = symbolName {
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
        if action.rootTab || action.id == "home" || action.id == "back" {
            for content in button.subviews.compactMap({ $0 as? UIStackView }) {
                for child in content.arrangedSubviews {
                    if let icon = child as? UIImageView, let name = action.systemImageName {
                        icon.image = UIImage(systemName: name, withConfiguration: AppSymbolSizing.configuration())
                        icon.tintColor = action.rootTab && action.selected ? NavigationGlassPalette.selectedRootTabForeground : .label
                        icon.accessibilityIdentifier = "\(action.testID)-UIImageView"
                    }
                    if let label = child as? UILabel {
                        label.text = action.label
                        label.font = NavigationTextMetrics.font(for: action, traits: button.traitCollection)
                        label.textColor = action.rootTab && action.selected ? NavigationGlassPalette.selectedRootTabForeground : .label
                        label.accessibilityIdentifier = "\(action.testID)-UILabel"
                    }
                }
            }
        }
    }

    /// Reapplies descriptor-driven configuration without replacing the mounted UIButton.
    private static func configure(_ button: UIButton, for action: NavigationActionDescriptor) {
        // UIKit has no busy trait; VoiceOver receives the operation state as its value.
        button.accessibilityValue = action.busy ? "진행 중" : nil
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
            // Explicit content below bounds symbols while the configuration keeps Glass styling.
            configuration.title = nil
            configuration.image = nil
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
        if !action.rootTab, action.id != "home", action.id != "back" {
            NavigationContextualActionContent.update(button, for: action)
        }
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

/// Decodes the React Native toolbar payload and supplies defaults for optional action flags.
struct NavigationActionDescriptor: Equatable {
    let id: String
    let label: String
    let accessibilityLabel: String
    let testID: String
    let systemImageName: String?
    let disabled: Bool
    let busy: Bool
    let primary: Bool
    let selected: Bool
    let rootTab: Bool
    let showsTitleWithSystemImage: Bool
    let titleBelowImage: Bool

    init?(_ value: Any) {
        guard
            let payload = value as? [String: Any],
            let id = payload["id"] as? String,
            let label = payload["label"] as? String,
            let accessibilityLabel = payload["accessibilityLabel"] as? String,
            let testID = payload["testID"] as? String
        else {
            return nil
        }

        self.id = id
        self.label = label
        self.accessibilityLabel = accessibilityLabel
        self.testID = testID
        systemImageName = payload["systemImageName"] as? String
        disabled = payload["disabled"] as? Bool ?? false
        busy = payload["busy"] as? Bool ?? false
        primary = payload["primary"] as? Bool ?? false
        selected = payload["selected"] as? Bool ?? false
        rootTab = payload["rootTab"] as? Bool ?? false
        showsTitleWithSystemImage = payload["showsTitleWithSystemImage"] as? Bool ?? false
        titleBelowImage = payload["titleBelowImage"] as? Bool ?? false
    }
}
