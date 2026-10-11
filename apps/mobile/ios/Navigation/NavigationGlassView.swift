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
        let back = actionButtons.first { $0.accessibilityIdentifier == "navigation-back" }
        let contextual = actionButtons.filter { $0 !== back }
        contextual.forEach(actionGroup.addArrangedSubview)
        groupWidth?.isActive = false
        let width = actionGroup.widthAnchor.constraint(equalToConstant: groupContentWidth)
        width.isActive = true
        groupWidth = width
        // A flexible gap keeps back physically separate from the contextual home capsule.
        var items: [UIBarButtonItem] = []
        if let back {
            items.append(UIBarButtonItem(customView: back))
        }
        items.append(.flexibleSpace())
        if !contextual.isEmpty {
            items.append(UIBarButtonItem(customView: actionGroup))
        }
        toolbar.setItems(items, animated: false)
        setNeedsLayout()
    }

    private var groupContentWidth: CGFloat {
        // Tighten the material's side gutters while keeping each native control at least 44 points wide.
        if actionButtons.contains(where: { $0.accessibilityIdentifier == "navigation-back" }) {
            return CGFloat(max(0, actionButtons.count - 1)) * 64
        }
        return max(CGFloat(actionButtons.count) * 44 + CGFloat(max(0, actionButtons.count - 1)) * 4,
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
            // Contextual back and home own separate glass surfaces; root tabs keep their shared material.
            action.primary || selectedRootTab ? .prominentGlass() :
                action.id == "back" || action.id == "home" ? .glass() : .plain()
        } else {
            action.primary || selectedRootTab ? .filled() : .plain()
        }
        if selectedRootTab {
            configuration.cornerStyle = .capsule
            configuration.baseBackgroundColor = NavigationGlassPalette.selectedRootTabBackground
        }
        if action.rootTab || action.id == "home" || action.id == "back" {
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
            ? NavigationGlassPalette.selectedRootTabForeground
            : action.selected ? NavigationGlassPalette.primaryTint : .label
        if action.id == "back" {
            configuration.title = nil
            configuration.cornerStyle = .capsule
        }
        if action.id == "home" {
            configuration.cornerStyle = .capsule
        }
        button.configuration = configuration
        if action.id == "back" {
            NavigationBackContent.attach(to: button, testID: action.testID)
        }
        if action.rootTab || action.id == "home", let name = action.systemImageName {
            let content = NavigationRootTabContent.make(
                label: action.label,
                symbolName: name,
                testID: action.testID,
                foregroundColor: action.selected ? NavigationGlassPalette.selectedRootTabForeground : .label,
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
        button.tintColor =
            action.primary
                ? NavigationGlassPalette.primaryTint
                : selectedRootTab
                ? NavigationGlassPalette.selectedRootTabBackground
                : action.selected ? NavigationGlassPalette.primaryTint : UIColor.label
        button.accessibilityTraits = action.selected ? [.button, .selected] : [.button]
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: action.rootTab ? 48 : 44),
        ])
        if action.id == "back" {
            button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        }
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
