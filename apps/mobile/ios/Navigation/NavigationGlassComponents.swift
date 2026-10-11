import UIKit

/// Decodes the React Native toolbar payload and supplies defaults for optional action flags.
struct NavigationActionDescriptor {
    let id: String
    let label: String
    let accessibilityLabel: String
    let testID: String
    let systemImageName: String?
    let disabled: Bool
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
        primary = payload["primary"] as? Bool ?? false
        selected = payload["selected"] as? Bool ?? false
        rootTab = payload["rootTab"] as? Bool ?? false
        showsTitleWithSystemImage = payload["showsTitleWithSystemImage"] as? Bool ?? false
        titleBelowImage = payload["titleBelowImage"] as? Bool ?? false
    }
}

enum NavigationRootTabContent {
    /// UIKit can expand configured symbol views; fixed native subviews preserve the tab's intended padding and gap.
    static func make(
        label: String,
        symbolName: String,
        testID: String,
        foregroundColor: UIColor,
    ) -> UIStackView {
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        // Leave visible separation even when XCTest rounds native child frames outward.
        stack.spacing = 4
        stack.isUserInteractionEnabled = false

        let icon = UIImageView(
            image: UIImage(
                systemName: symbolName,
                withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: 22,
                    weight: .medium,
                ),
            ),
        )
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.contentMode = .scaleAspectFit
        icon.tintColor = foregroundColor
        icon.isAccessibilityElement = false
        icon.accessibilityIdentifier = "\(testID)-UIImageView"

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = label
        title.font = .systemFont(ofSize: 12, weight: .medium)
        title.textAlignment = .center
        title.textColor = foregroundColor
        title.numberOfLines = 1
        title.isAccessibilityElement = false
        title.accessibilityIdentifier = "\(testID)-UILabel"

        stack.addArrangedSubview(icon)
        stack.addArrangedSubview(title)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 22),
            icon.heightAnchor.constraint(equalToConstant: 22),
        ])
        return stack
    }
}
