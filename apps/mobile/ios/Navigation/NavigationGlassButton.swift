import UIKit

/// Builds native controls while keeping persistent selection exclusive to root tabs.
enum NavigationGlassButton {
    static func make(for action: NavigationActionDescriptor, onAction: @escaping (String) -> Void) -> UIButton {
        let button = UIButton(type: .system)
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
        if action.id == "back" {
            NavigationBackContent.attach(to: button, testID: action.testID)
        }
        if action.rootTab || action.id == "home", let name = action.systemImageName {
            let content = NavigationRootTabContent.make(
                label: action.label,
                symbolName: name,
                testID: action.testID,
                foregroundColor: selectedRootTab ? NavigationGlassPalette.selectedRootTabForeground : .label,
                titleSize: action.rootTab ? 12 : 11,
            )
            button.addSubview(content)
            NSLayoutConstraint.activate([
                content.centerXAnchor.constraint(equalTo: button.centerXAnchor),
                content.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            ])
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
        button.translatesAutoresizingMaskIntoConstraints = false
        // Root tabs grow while contextual primary actions keep their separate target size.
        let height: CGFloat = action.rootTab ? 52 : 48
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: height),
        ])
        if action.id == "back" || action.id == "home" {
            button.widthAnchor.constraint(equalToConstant: action.id == "home" ? 64 : 48).isActive = true
        }
        button.addAction(UIAction(title: action.label) { _ in
            // Stable IDs keep UIKit input connected to the existing JS navigation handlers.
            onAction(action.id)
        }, for: .touchUpInside)

        return button
    }
}
