import UIKit

/// Decodes the React Native toolbar payload and supplies defaults for optional action flags.
struct NavigationActionDescriptor: Equatable {
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

/** Cross-fades native navigation action updates from their current state and honors Reduce Motion. */
enum NavigationToolbarTransition {
    static func apply(to view: UIView, animated: Bool, changes: @escaping () -> Void) {
        guard animated, !UIAccessibility.isReduceMotionEnabled else {
            changes()
            return
        }

        UIView.transition(
            with: view,
            duration: 0.14,
            options: [.transitionCrossDissolve, .beginFromCurrentState, .allowAnimatedContent],
            animations: changes,
        )
    }
}

enum NavigationRootTabContent {
    /// UIKit can expand configured symbol views; fixed native subviews preserve the tab's intended padding and gap.
    static func make(
        label: String,
        symbolName: String,
        testID: String,
        foregroundColor: UIColor,
        titleSize: CGFloat = 12,
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
        title.font = .systemFont(ofSize: titleSize, weight: .medium)
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

/// Bounds the chevron independently from its 44pt glass target so UIKit cannot enlarge it.
enum NavigationBackContent {
    static func attach(to button: UIButton, testID: String) {
        let icon = UIImageView(image: UIImage(
            systemName: "chevron.left",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .medium),
        ))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.contentMode = .scaleAspectFit
        icon.tintColor = .label
        icon.isUserInteractionEnabled = false
        icon.isAccessibilityElement = false
        icon.accessibilityIdentifier = "\(testID)-UIImageView"
        button.addSubview(icon)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 20),
            icon.heightAnchor.constraint(equalToConstant: 20),
            icon.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: button.centerYAnchor),
        ])
    }
}

/// Shares semantic native colors between grouped tabs and independent contextual controls.
enum NavigationGlassPalette {
    /// Color values use 8-bit channels; UIColor expects normalized 0...1 components.
    static func rgbColor(red: Int, green: Int, blue: Int) -> UIColor {
        UIColor(
            red: CGFloat(red) / 255,
            green: CGFloat(green) / 255,
            blue: CGFloat(blue) / 255,
            alpha: 1,
        )
    }

    static let primaryTint = UIColor { traits in
        // Darken the brand tint in higher-contrast settings while retaining its hue.
        traits.accessibilityContrast == .high
            ? rgbColor(red: 31, green: 93, blue: 184)
            : rgbColor(red: 49, green: 130, blue: 246)
    }

    static let selectedRootTabBackground = UIColor.secondarySystemFill
    static let selectedRootTabForeground = UIColor { traits in
        // Keep small selected labels readable by adapting the brand hue to appearance and contrast.
        let color: (Int, Int, Int) = if traits.userInterfaceStyle == .dark {
            traits.accessibilityContrast == .high ? (179, 208, 255) : (141, 187, 255)
        } else {
            (31, 93, 184)
        }
        return rgbColor(red: color.0, green: color.1, blue: color.2)
    }
}
