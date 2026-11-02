import UIKit

/// One typography contract supplies both UIKit labels and their layout measurements.
enum NavigationTextMetrics {
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
        let title = (action.label as NSString).size(withAttributes: [.font: font(for: action, traits: traits)]).width
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
        let line = font(for: action, traits: traits).lineHeight
        if action.rootTab {
            return ceil(max(60, 18 + 4 + line + 16))
        }
        if action.id == "back" || action.id == "home" {
            return ceil(max(48, 18 + 4 + line + 8))
        }
        return ceil(max(48, action.systemImageName == nil ? line + 24 : 18 + 2 + line + 10))
    }
}
