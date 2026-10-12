import React
import UIKit

/// Hosts the route's shared, system-rendered bottom toolbar and its UIKit actions.
final class NavigationGlassSurfaceView: UIView {
    @objc var actions: NSArray = [] {
        didSet {
            let descriptors = actions.compactMap(NavigationActionDescriptor.init)
            guard descriptors != renderedActions else { return }

            let shouldAnimate = hasInstalledActionItems
            renderedActions = descriptors
            rebuildToolbarItems(descriptors, animated: shouldAnimate)
            hasInstalledActionItems = hasInstalledActionItems || !descriptors.isEmpty
        }
    }

    @objc var onAction: RCTBubblingEventBlock?

    private let toolbar = UIToolbar()
    private var actionButtons: [UIButton] = []
    private var renderedActions: [NavigationActionDescriptor] = []
    private var hasInstalledActionItems = false
    private let actionGroup = UIStackView()
    private var rootTabGlassBackdrop: UIVisualEffectView?
    private var groupWidth: NSLayoutConstraint?
    private var rootTabGroupConstraints: [NSLayoutConstraint] = []
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
        actionGroup.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: trailingAnchor),
            toolbar.topAnchor.constraint(equalTo: topAnchor),
            toolbar.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    /// Rebuild changed actions once, cross-fading later route or selection updates from their current state.
    private func rebuildToolbarItems(
        _ descriptors: [NavigationActionDescriptor],
        animated: Bool,
    ) {
        let hadRootTabs = actionGroup.superview === self
        let hasRootTabs = descriptors.contains(where: \.rootTab)
        let transitionView: UIView = hadRootTabs && hasRootTabs
            ? actionGroup
            : hadRootTabs || hasRootTabs ? self : toolbar
        let buttons = descriptors.map(makeToolbarButton)
        actionButtons = buttons
        let back = buttons.first { $0.accessibilityIdentifier == "navigation-back" }
        let contextual = buttons.filter { $0 !== back }

        // Root hit targets sit outside UIToolbar's safe-area-clipped content; the glass container merges them into one bar.
        NavigationToolbarTransition.apply(to: transitionView, animated: animated) {
            self.actionGroup.arrangedSubviews.forEach { view in
                self.actionGroup.removeArrangedSubview(view)
                view.removeFromSuperview()
            }
            self.actionGroup.axis = .horizontal
            self.actionGroup.distribution = .fillEqually
            self.actionGroup.spacing = 4
            self.groupWidth?.isActive = false
            let width = self.actionGroup.widthAnchor.constraint(equalToConstant: self.groupContentWidth)
            width.isActive = true
            self.groupWidth = width

            if hasRootTabs {
                self.actionGroup.isAccessibilityElement = false
                self.addActionGroupToRootSurface()
                buttons.forEach(self.actionGroup.addArrangedSubview)
                self.toolbar.setItems([], animated: false)
                self.toolbar.isHidden = true
                self.setNeedsLayout()
                return
            }

            self.removeActionGroupFromRootSurface()
            self.toolbar.isHidden = false
            guard !buttons.isEmpty else {
                self.toolbar.setItems([], animated: false)
                return
            }

            contextual.forEach(self.actionGroup.addArrangedSubview)
            // A flexible gap keeps back physically separate from the contextual home capsule.
            var items: [UIBarButtonItem] = []
            if let back {
                items.append(UIBarButtonItem(customView: back))
            }
            items.append(.flexibleSpace())
            if !contextual.isEmpty {
                items.append(UIBarButtonItem(customView: self.actionGroup))
            }
            self.toolbar.setItems(items, animated: false)
            self.setNeedsLayout()
        }
    }

    private func addActionGroupToRootSurface() {
        let backdrop = rootTabGlassBackdrop ?? makeRootTabGlassBackdrop()
        if backdrop.superview == nil {
            backdrop.translatesAutoresizingMaskIntoConstraints = false
            addSubview(backdrop)
            NSLayoutConstraint.activate([
                backdrop.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
                backdrop.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
                backdrop.heightAnchor.constraint(equalToConstant: 52),
                backdrop.centerYAnchor.constraint(equalTo: centerYAnchor),
            ])
            rootTabGlassBackdrop = backdrop
        }
        backdrop.isHidden = false
        let host = backdrop.contentView
        guard actionGroup.superview !== host else { return }

        NSLayoutConstraint.deactivate(rootTabGroupConstraints)
        rootTabGroupConstraints.removeAll()
        actionGroup.removeFromSuperview()
        host.addSubview(actionGroup)
        let constraints = [
            actionGroup.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            actionGroup.centerYAnchor.constraint(equalTo: host.centerYAnchor),
        ]
        NSLayoutConstraint.activate(constraints)
        rootTabGroupConstraints = constraints
    }

    private func removeActionGroupFromRootSurface() {
        NSLayoutConstraint.deactivate(rootTabGroupConstraints)
        rootTabGroupConstraints.removeAll()
        if let host = rootTabGlassBackdrop?.contentView, actionGroup.superview === host {
            actionGroup.removeFromSuperview()
        }
        rootTabGlassBackdrop?.isHidden = true
    }

    private func makeRootTabGlassBackdrop() -> UIVisualEffectView {
        let effect: UIVisualEffect
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.isInteractive = false
            effect = glass
        } else {
            effect = UIBlurEffect(style: .systemMaterial)
        }
        let backdrop = UIVisualEffectView(effect: effect)
        backdrop.accessibilityIdentifier = "navigation-root-tabs-glass-backdrop"
        backdrop.isAccessibilityElement = false
        backdrop.isUserInteractionEnabled = false
        backdrop.layer.cornerRadius = 26
        backdrop.layer.cornerCurve = .continuous
        backdrop.clipsToBounds = true
        return backdrop
    }

    private var groupContentWidth: CGFloat {
        if actionButtons.contains(where: { $0.accessibilityIdentifier == "navigation-back" }) {
            // Measure contextual titles so localized Generate and Cancel labels fit inside the glass group.
            let contextual = actionButtons.filter { $0.accessibilityIdentifier != "navigation-back" }
            let titledWidths = contextual.compactMap { button -> CGFloat? in
                guard let title = button.configuration?.title else { return nil }
                return (title as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 13)]).width + 24
            }
            let width = max(88, titledWidths.max() ?? 64)
            return CGFloat(contextual.count) * width + CGFloat(max(0, contextual.count - 1)) * 4
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
        var configuration: UIButton.Configuration = if action.rootTab {
            .plain()
        } else if #available(iOS 26.0, *) {
            // Root tabs use one shared backdrop; contextual Back/Home retain their own glass buttons.
            action.primary ? .prominentGlass() :
                action.id == "back" || action.id == "home" ? .glass() : .plain()
        } else {
            action.primary ? .filled() : .plain()
        }
        if action.rootTab {
            var background = UIBackgroundConfiguration.clear()
            if selectedRootTab {
                background.backgroundColor = NavigationGlassPalette.selectedRootTabBackground
                configuration.cornerStyle = .capsule
            }
            configuration.background = background
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
            configuration.titleLineBreakMode = .byClipping
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var updated = attributes
                let titleSize: CGFloat = action.titleBelowImage ? 10 : 13
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
        button.accessibilityTraits = selectedRootTab ? [.button, .selected] : [.button]
        button.translatesAutoresizingMaskIntoConstraints = false
        // Root tabs grow while contextual primary actions keep their separate target size.
        let height: CGFloat = action.rootTab ? 52 : action.primary ? 48 : 44
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: height),
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
