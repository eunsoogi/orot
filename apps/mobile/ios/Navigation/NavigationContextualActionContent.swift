import UIKit

/// Keeps contextual glyphs in the same compact image canvas as body and root symbols.
enum NavigationContextualActionContent {
    private static let contentIdentifier = "navigation-contextual-action-content"
    private static let maximumWidthConstraintIdentifier = "navigation-contextual-action-content-maximum-width"
    private static let maximumHeightConstraintIdentifier = "navigation-contextual-action-content-maximum-height"

    static func update(_ button: UIButton, for action: NavigationActionDescriptor) {
        let content: UIStackView
        if let existing = button.subviews.compactMap({ $0 as? UIStackView }).first(where: {
            $0.accessibilityIdentifier == contentIdentifier
        }) {
            content = existing
        } else {
            content = UIStackView()
            content.translatesAutoresizingMaskIntoConstraints = false
            content.accessibilityIdentifier = contentIdentifier
            content.isAccessibilityElement = false
            content.isUserInteractionEnabled = false
            button.addSubview(content)
            let maximumWidth = content.widthAnchor.constraint(lessThanOrEqualTo: button.widthAnchor, constant: -24)
            maximumWidth.identifier = maximumWidthConstraintIdentifier
            let maximumHeight = content.heightAnchor.constraint(lessThanOrEqualTo: button.heightAnchor, constant: -24)
            maximumHeight.identifier = maximumHeightConstraintIdentifier
            NSLayoutConstraint.activate([
                content.centerXAnchor.constraint(equalTo: button.centerXAnchor),
                content.centerYAnchor.constraint(equalTo: button.centerYAnchor),
                maximumWidth,
                maximumHeight,
            ])
        }

        let inset: CGFloat = action.showsTitleWithSystemImage ? 5 : 12
        button.constraints.first(where: { $0.identifier == maximumWidthConstraintIdentifier })?.constant = -2 * inset
        button.constraints.first(where: { $0.identifier == maximumHeightConstraintIdentifier })?.constant = -2 * inset
        content.axis = action.titleBelowImage ? .vertical : .horizontal
        content.alignment = .center
        content.distribution = .fill
        content.spacing = action.showsTitleWithSystemImage ? 2 : 0
        content.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        for child in content.arrangedSubviews {
            content.removeArrangedSubview(child)
            child.removeFromSuperview()
        }

        let foregroundColor: UIColor = action.primary ? .white : .label
        if let symbolName = action.systemImageName {
            let icon = UIImageView(
                image: UIImage(systemName: symbolName, withConfiguration: AppSymbolSizing.configuration()),
            )
            icon.translatesAutoresizingMaskIntoConstraints = false
            icon.contentMode = .scaleAspectFit
            icon.tintColor = foregroundColor
            icon.isAccessibilityElement = false
            icon.accessibilityIdentifier = "\(action.testID)-UIImageView"
            content.addArrangedSubview(icon)
            NSLayoutConstraint.activate([
                icon.widthAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
                icon.heightAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
            ])
        }

        if action.systemImageName == nil || action.showsTitleWithSystemImage {
            let title = UILabel()
            title.text = action.label
            title.font = NavigationTextMetrics.font(for: action, traits: button.traitCollection)
            title.adjustsFontForContentSizeCategory = true
            title.textAlignment = .center
            title.textColor = foregroundColor
            title.numberOfLines = 1
            title.lineBreakMode = .byTruncatingTail
            title.isAccessibilityElement = false
            title.accessibilityIdentifier = "\(action.testID)-UILabel"
            title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            content.addArrangedSubview(title)
        }
    }
}
