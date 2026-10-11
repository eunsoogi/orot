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
    private let actionGroup = UIStackView()
    private var groupWidth: NSLayoutConstraint?
    /// Color values use 8-bit channels; UIColor expects normalized 0...1 components.
    private static func rgbColor(red: Int, green: Int, blue: Int) -> UIColor {
        UIColor(
            red: CGFloat(red) / 255,
            green: CGFloat(green) / 255,
            blue: CGFloat(blue) / 255,
            alpha: 1,
        )
    }

    private static let primaryTint = UIColor { traits in
        // Darken the brand tint in higher-contrast settings while retaining its hue.
        traits.accessibilityContrast == .high
            ? NavigationGlassSurfaceView.rgbColor(red: 31, green: 93, blue: 184)
            : NavigationGlassSurfaceView.rgbColor(red: 49, green: 130, blue: 246)
    }

    private static let selectedRootTabBackground = UIColor.secondarySystemFill
    private static let selectedRootTabForeground = UIColor { traits in
        // Keep small selected labels readable by adapting the brand hue to appearance and contrast.
        let color: (Int, Int, Int) = if traits.userInterfaceStyle == .dark {
            traits.accessibilityContrast == .high ? (179, 208, 255) : (141, 187, 255)
        } else {
            (31, 93, 184)
        }
        return NavigationGlassSurfaceView.rgbColor(red: color.0, green: color.1, blue: color.2)
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
        actionGroup.arrangedSubviews.forEach { $0.removeFromSuperview() }
        actionButtons = actions.compactMap(NavigationActionDescriptor.init).map(makeToolbarButton)
        guard !actionButtons.isEmpty else {
            toolbar.setItems([], animated: false)
            return
        }

        // One custom item prevents UIKit from moving individual root tabs into its overflow menu.
        actionGroup.axis = .horizontal
        actionGroup.distribution = .fillEqually
        actionGroup.spacing = 4
        actionButtons.forEach(actionGroup.addArrangedSubview)
        groupWidth?.isActive = false
        let width = actionGroup.widthAnchor.constraint(equalToConstant: groupContentWidth)
        width.isActive = true
        groupWidth = width
        toolbar.setItems(
            [.flexibleSpace(), UIBarButtonItem(customView: actionGroup), .flexibleSpace()],
            animated: false,
        )
        setNeedsLayout()
    }

    private var groupContentWidth: CGFloat {
        // Tighten the material's side gutters while keeping each native control at least 44 points wide.
        max(CGFloat(actionButtons.count) * 44 + CGFloat(max(0, actionButtons.count - 1)) * 4,
            bounds.width - 32)
    }

    override func layoutSubviews() {
        groupWidth?.constant = groupContentWidth
        super.layoutSubviews()
    }

    private func makeToolbarButton(for action: NavigationActionDescriptor) -> UIButton {
        let button = UIButton(type: .system)
        let selectedRootTab = action.rootTab && action.selected
        var configuration: UIButton.Configuration = if #available(iOS 26.0, *) {
            // Nonprimary icons share the toolbar's native material instead of drawing separate bubbles.
            action.primary || selectedRootTab ? .prominentGlass() : .plain()
        } else {
            action.primary || selectedRootTab ? .filled() : .plain()
        }
        if selectedRootTab {
            configuration.cornerStyle = .capsule
            configuration.baseBackgroundColor = Self.selectedRootTabBackground
        }
        if action.rootTab {
            // Keep UIKit's glass background while drawing tab content in explicitly bounded native views.
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
            if action.showsTitleWithSystemImage {
                configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                    var updated = attributes
                    let titleSize: CGFloat = action.titleBelowImage ? 10 : 14
                    updated.font = .systemFont(ofSize: titleSize, weight: .medium)
                    return updated
                }
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
            ? Self.selectedRootTabForeground
            : action.selected ? Self.primaryTint : .label
        button.configuration = configuration
        if action.rootTab, let name = action.systemImageName {
            let content = NavigationRootTabContent.make(
                label: action.label,
                symbolName: name,
                testID: action.testID,
                foregroundColor: action.selected ? Self.selectedRootTabForeground : .label,
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
        button.tintColor =
            action.primary
                ? Self.primaryTint
                : selectedRootTab
                ? Self.selectedRootTabBackground
                : action.selected ? Self.primaryTint : UIColor.label
        button.accessibilityTraits = action.selected ? [.button, .selected] : [.button]
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: action.rootTab ? 48 : 44),
        ])
        button.addAction(UIAction(title: action.label) { [weak self] _ in
            // Stable IDs keep UIKit input connected to the existing JS navigation handlers.
            self?.onAction?(["id": action.id])
        }, for: .touchUpInside)

        return button
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
