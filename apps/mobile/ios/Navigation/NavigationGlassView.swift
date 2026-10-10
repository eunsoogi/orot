import React
import UIKit

/// Hosts the route's shared, system-rendered bottom toolbar and its UIKit actions.
final class NavigationGlassSurfaceView: UIView {
    @objc var actions: NSArray = [] {
        didSet {
            rebuildToolbarItems()
        }
    }

    @objc var onAction: RCTBubblingEventBlock?

    private let toolbar = UIToolbar()
    private var actionButtons: [UIButton] = []
    private static let primaryTint = UIColor { traits in
        // Darken the brand tint in higher-contrast settings while retaining its hue.
        if traits.accessibilityContrast == .high {
            return UIColor(
                red: CGFloat(31) / 255,
                green: CGFloat(93) / 255,
                blue: CGFloat(184) / 255,
                alpha: 1,
            )
        }
        return UIColor(
            red: CGFloat(49) / 255,
            green: CGFloat(130) / 255,
            blue: CGFloat(246) / 255,
            alpha: 1,
        )
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        configure()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configure()
    }

    /// Route touches to mounted controls while leaving the empty glass area available to route scrolling.
    override func hitTest(_ point: CGPoint, with _: UIEvent?) -> UIView? {
        guard bounds.contains(point) else { return nil }

        // Return the UIKit control directly because transparent toolbar backing can be omitted from hit-test results.
        for button in actionButtons.reversed() {
            guard
                button.superview != nil,
                !button.isHidden,
                button.alpha > 0.01,
                button.isUserInteractionEnabled
            else {
                continue
            }

            if button.bounds.contains(button.convert(point, from: self)) {
                return button
            }
        }

        return nil
    }

    private func configure() {
        // Leave toolbar appearance and background untouched so UIKit supplies its native material.
        backgroundColor = .clear
        isOpaque = false
        clipsToBounds = false
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        toolbar.accessibilityIdentifier = "navigation-native-toolbar"
        addSubview(toolbar)
        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: trailingAnchor),
            toolbar.topAnchor.constraint(equalTo: topAnchor),
            toolbar.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    private func rebuildToolbarItems() {
        actionButtons = actions.compactMap(NavigationActionDescriptor.init).map(makeToolbarButton)
        guard !actionButtons.isEmpty else {
            toolbar.setItems([], animated: false)
            return
        }

        // Flexible edge spaces center one shared item group; fixed spaces would split its glass background.
        let buttonItems = actionButtons.map { UIBarButtonItem(customView: $0) }
        toolbar.setItems(
            [.flexibleSpace()] + buttonItems + [.flexibleSpace()],
            animated: false,
        )
    }

    private func makeToolbarButton(for action: NavigationActionDescriptor) -> UIButton {
        let button = UIButton(type: .system)
        var configuration: UIButton.Configuration = if #available(iOS 26.0, *) {
            // Nonprimary icons share the toolbar's native material instead of drawing separate bubbles.
            action.primary ? .prominentGlass() : .plain()
        } else {
            action.primary ? .filled() : .plain()
        }
        configuration.title = action.systemImageName == nil ? action.label : nil
        if let name = action.systemImageName {
            configuration.image = UIImage(
                systemName: name,
                withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: 18,
                    weight: .semibold,
                ),
            )
        }
        configuration.imagePlacement = .leading
        configuration.imagePadding = 6
        // Keep the visible control itself at least 44 points high for reliable touch and AX frames.
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 12,
            leading: 12,
            bottom: 12,
            trailing: 12,
        )
        button.configuration = configuration
        button.accessibilityLabel = action.accessibilityLabel
        button.accessibilityIdentifier = action.testID
        button.isEnabled = !action.disabled
        button.tintColor = action.primary ? Self.primaryTint : UIColor.label
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
        button.addAction(UIAction(title: action.label) { [weak self] _ in
            // Stable IDs keep UIKit input connected to the existing JS navigation handlers.
            self?.onAction?(["id": action.id])
        }, for: .touchUpInside)

        return button
    }
}

private struct NavigationActionDescriptor {
    let id: String
    let label: String
    let accessibilityLabel: String
    let testID: String
    let systemImageName: String?
    let disabled: Bool
    let primary: Bool

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
    }
}

@objc(NavigationGlassViewManager)
final class NavigationGlassViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        NavigationGlassSurfaceView()
    }
}
