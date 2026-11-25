import UIKit

/// One typography contract supplies both UIKit labels and their layout measurements.
enum NavigationTextMetrics {
    static let pageIconDiameter: CGFloat = 48

    static func applyPageIconShape(_ action: NavigationActionDescriptor, to button: UIButton, usesRightRail: Bool) {
        if action.isIconOnlyPageAction, var configuration = button.configuration {
            // Use the default style again on rail transitions without remounting the control.
            if !usesRightRail {
                configuration.cornerStyle = .capsule
            } else if #available(iOS 26.0, *) {
                configuration.cornerStyle = action.primary ? UIButton.Configuration.prominentGlass().cornerStyle : UIButton.Configuration.plain().cornerStyle
            } else {
                configuration.cornerStyle = action.primary ? UIButton.Configuration.filled().cornerStyle : UIButton.Configuration.plain().cornerStyle
            }
            button.configuration = configuration
        }
    }

    /// Spoken labels must not drive compact geometry when not painted.
    private static func hasVisibleTitle(_ action: NavigationActionDescriptor) -> Bool {
        if action.rootTab || action.id == "back" || action.id == "home" {
            return action.showsTitleWithSystemImage
        }
        return action.systemImageName == nil || action.showsTitleWithSystemImage
    }

    static func font(size: CGFloat, traits: UITraitCollection) -> UIFont {
        UIFontMetrics(forTextStyle: .caption1).scaledFont(
            for: .systemFont(ofSize: size, weight: .medium), compatibleWith: traits,
        )
    }

    static func font(for action: NavigationActionDescriptor, traits: UITraitCollection) -> UIFont {
        let size: CGFloat = action.rootTab ? 12 : action.id == "back" || action.id == "home" ? 11 : 14
        return font(size: size, traits: traits)
    }

    static func width(for action: NavigationActionDescriptor, traits: UITraitCollection) -> CGFloat {
        if action.isIconOnlyPageAction {
            return pageIconDiameter
        }
        let title = hasVisibleTitle(action)
            ? (action.label as NSString).size(withAttributes: [.font: font(for: action, traits: traits)]).width
            : 0
        if action.rootTab {
            return ceil(max(44, title + 8))
        }
        if action.id == "back" {
            return ceil(max(48, title + 8))
        }
        if action.id == "home" {
            return ceil(max(64, title + 8))
        }
        return ceil(max(action.id == "page:overflow" ? 44 : 88, title + 24))
    }

    static func height(for action: NavigationActionDescriptor, traits: UITraitCollection) -> CGFloat {
        if !hasVisibleTitle(action) {
            return action.rootTab ? 60 : 48
        }
        let line = font(for: action, traits: traits).lineHeight
        if action.rootTab {
            return ceil(max(60, 18 + 4 + line + 16))
        }
        if action.id == "back" || action.id == "home" {
            return ceil(max(48, 18 + 4 + line + 8))
        }
        if let width = action.layoutWidth, action.showsTitleWithSystemImage {
            let title = UILabel()
            title.text = action.label
            title.font = font(for: action, traits: traits)
            title.numberOfLines = 0
            title.lineBreakMode = .byWordWrapping
            let textHeight = title.sizeThatFits(CGSize(width: max(1, width - 10), height: .greatestFiniteMagnitude)).height
            return ceil(max(48, 18 + 2 + textHeight + 10))
        }
        return ceil(max(48, action.systemImageName == nil ? line + 24 : 18 + 2 + line + 10))
    }
}

extension NavigationActionDescriptor {
    /// Spoken-only page labels never size standalone controls, unlike text actions and root tabs.
    var isIconOnlyPageAction: Bool {
        !rootTab && id.hasPrefix("page:") && systemImageName != nil && !showsTitleWithSystemImage
    }
}
