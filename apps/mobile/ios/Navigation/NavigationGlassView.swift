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
    private var buttonWidths: [NSLayoutConstraint] = []
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
        buttonWidths = []
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
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Give one continuous glass group the available screen width instead of hugging small icons.
        // UIKit adds group insets and inter-item spacing; reserve them to avoid its overflow menu.
        let width = max(44, (bounds.width - 80) / CGFloat(max(1, buttonWidths.count)))
        buttonWidths.forEach { $0.constant = width }
    }

    private func makeToolbarButton(for action: NavigationActionDescriptor) -> UIButton {
        let button = UIButton(type: .system)
        var configuration: UIButton.Configuration = if #available(iOS 26.0, *) {
            // Nonprimary icons share the toolbar's native material instead of drawing separate bubbles.
            action.primary ? .prominentGlass() : .plain()
        } else {
            action.primary ? .filled() : .plain()
        }
        configuration.title =
            action.systemImageName == nil || action.showsTitleWithSystemImage
                ? action.label
                : nil
        if let name = action.systemImageName {
            configuration.image = UIImage(
                systemName: name,
                withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: 18,
                    weight: .semibold,
                ),
            )
        }
        configuration.imagePlacement = action.titleBelowImage ? .top : .leading
        configuration.imagePadding = action.showsTitleWithSystemImage ? 2 : 6
        if action.showsTitleWithSystemImage {
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var updated = attributes
                updated.font = .systemFont(ofSize: action.titleBelowImage ? 10 : 14, weight: .medium)
                return updated
            }
        }
        // The five tab targets share the glass background and retain a 44-point hit area.
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: action.showsTitleWithSystemImage ? 5 : 12,
            leading: action.showsTitleWithSystemImage ? 5 : 12,
            bottom: action.showsTitleWithSystemImage ? 5 : 12,
            trailing: action.showsTitleWithSystemImage ? 5 : 12,
        )
        configuration.baseForegroundColor = action.primary ? .white : action.selected ? Self.primaryTint : .label
        button.configuration = configuration
        button.accessibilityLabel = action.accessibilityLabel
        button.accessibilityIdentifier = action.testID
        button.isEnabled = !action.disabled
        button.tintColor =
            action.primary || action.selected ? Self.primaryTint : UIColor.label
        button.accessibilityTraits = action.selected ? [.button, .selected] : [.button]
        button.translatesAutoresizingMaskIntoConstraints = false
        let width = button.widthAnchor.constraint(equalToConstant: 44)
        buttonWidths.append(width)
        NSLayoutConstraint.activate([
            width,
            button.heightAnchor.constraint(equalToConstant: 52),
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
    let selected: Bool
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
        showsTitleWithSystemImage = payload["showsTitleWithSystemImage"] as? Bool ?? false
        titleBelowImage = payload["titleBelowImage"] as? Bool ?? false
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
