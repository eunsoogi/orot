import React
import UIKit

/// Keeps one native surface and its controls mounted while actions or measured placement change.
final class NavigationGlassSurfaceView: UIView {
    @objc var actions: NSArray = [] {
        didSet {
            let descriptors = actions.compactMap(NavigationActionDescriptor.init)
            guard descriptors != renderedActions else { return }
            render(descriptors)
        }
    }

    @objc var onAction: RCTBubblingEventBlock?
    @objc var layoutMode: String = "bottom" {
        didSet { updatePresentation() }
    }

    @objc var railTopInset: CGFloat = 0 {
        didSet { updatePresentation() }
    }

    @objc var railBottomInset: CGFloat = 0 {
        didSet { updatePresentation() }
    }

    @objc var railRightInset: CGFloat = 0 {
        didSet { updatePresentation() }
    }

    @objc var railAvailableHeight: CGFloat = 0 {
        didSet { updatePresentation() }
    }

    private let rootBar = NavigationRootGlassBar()
    private let windowRailHost = NavigationWindowRailHost()
    override var isHidden: Bool {
        didSet { windowRailHost.isHidden = isHidden }
    }

    private let innerActions = UIStackView()
    private let innerActionsSpacer = UIView()
    private var renderedActions: [NavigationActionDescriptor] = []
    private var contextualButtons: [String: UIButton] = [:]
    private var contextualButtonWidthConstraints: [String: NSLayoutConstraint] = [:]
    private var contextualButtonFixedWidthConstraints: [String: NSLayoutConstraint] = [:]
    private var bottomPlacementConstraints: [NSLayoutConstraint] = []
    private var railPlacementConstraints: [NSLayoutConstraint] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        configure()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configure()
    }

    private func configure() {
        backgroundColor = .clear
        isOpaque = false
        rootBar.isHidden = true
        innerActions.isHidden = true
        innerActions.axis = .horizontal
        innerActions.alignment = .center
        innerActions.spacing = 12
        innerActionsSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        innerActionsSpacer.setContentHuggingPriority(.defaultLow, for: .vertical)
        innerActionsSpacer.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        innerActions.addArrangedSubview(innerActionsSpacer)
        // Match the native UI tests' shared toolbar identifier for contextual navigation actions.
        innerActions.accessibilityIdentifier = "navigation-toolbar"
        for view in [rootBar, innerActions] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        bottomPlacementConstraints = [
            rootBar.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            rootBar.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            rootBar.centerYAnchor.constraint(equalTo: centerYAnchor),
            rootBar.heightAnchor.constraint(equalToConstant: 60),
            innerActions.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            innerActions.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            innerActions.centerYAnchor.constraint(equalTo: centerYAnchor),
            innerActions.heightAnchor.constraint(equalToConstant: 48),
        ]
        configureRailConstraints(in: self)
        updatePresentation()
    }

    private func configureRailConstraints(in host: UIView) {
        railPlacementConstraints = NavigationRailConstraints.make(rootBar: rootBar, innerActions: innerActions, host: host)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updatePresentation()
    }

    override func layoutSubviews() {
        let host = layoutMode == "right" ? windowRailHost.mount(for: self, availableHeight: railAvailableHeight) : nil
        if rootBar.superview !== (host ?? self) {
            updatePresentation()
        }
        super.layoutSubviews()
    }

    private func render(_ descriptors: [NavigationActionDescriptor]) {
        let wasRoot = renderedActions.contains(where: \.rootTab)
        let isRoot = descriptors.contains(where: \.rootTab)
        let animated = !renderedActions.isEmpty
        renderedActions = descriptors
        let dispatch: (String) -> Void = { [weak self] id in self?.onAction?(["id": id]) }
        // Selection updates retain the same indicator rather than fading recreated button backgrounds.
        if wasRoot, isRoot {
            updatePresentation()
            rootBar.render(descriptors, animated: animated, onAction: dispatch)
            return
        }
        NavigationToolbarTransition.apply(to: self, animated: animated) {
            self.updatePresentation()
            if isRoot {
                self.rootBar.render(descriptors, animated: false, onAction: dispatch)
            } else {
                self.renderInnerActions(descriptors, onAction: dispatch)
            }
            self.layoutIfNeeded()
        }
    }

    /// Reparents existing controls into a window-coordinate host without changing action identity.
    private func updatePresentation() {
        let usesRightRail = layoutMode == "right"
        NSLayoutConstraint.deactivate(bottomPlacementConstraints + railPlacementConstraints)
        let host = usesRightRail ? windowRailHost.mount(for: self, availableHeight: railAvailableHeight) ?? self : self
        if rootBar.superview !== host {
            for view in [rootBar, innerActions] {
                host.addSubview(view)
            }
            configureRailConstraints(in: host)
        }
        if host === self {
            windowRailHost.removeFromSuperview()
        }
        bottomPlacementConstraints.forEach { $0.isActive = !usesRightRail }
        railPlacementConstraints.forEach { $0.isActive = usesRightRail }
        railPlacementConstraints[0].constant = -railRightInset
        railPlacementConstraints[3].constant = -railBottomInset
        railPlacementConstraints[5].constant = -railRightInset
        railPlacementConstraints[6].constant = railTopInset
        railPlacementConstraints[7].constant = -railBottomInset
        rootBar.setVerticalLayout(usesRightRail)
        innerActions.axis = usesRightRail ? .vertical : .horizontal
        innerActions.alignment = usesRightRail ? .fill : .center
        for (id, button) in contextualButtons {
            guard let action = renderedActions.first(where: { $0.id == id }) else { continue }
            updateFixedWidth(for: action, button: button)
        }
        rootBar.isHidden = !renderedActions.contains(where: \.rootTab)
        innerActions.isHidden = rootBar.isHidden == false
        setNeedsLayout()
    }

    /// Reconciles by stable action ID so state-only updates do not detach an active control.
    private func renderInnerActions(_ descriptors: [NavigationActionDescriptor], onAction: @escaping (String) -> Void) {
        let back = descriptors.first { $0.id == "back" }
        let actions = descriptors.filter { $0.id != "back" }
        let desiredIDs = Set(descriptors.map(\.id))
        let removedIDs = contextualButtons.keys.filter { !desiredIDs.contains($0) }
        for id in removedIDs {
            guard let button = contextualButtons.removeValue(forKey: id) else { continue }
            innerActions.removeArrangedSubview(button)
            button.removeFromSuperview()
            contextualButtonWidthConstraints.removeValue(forKey: id)?.isActive = false
            contextualButtonFixedWidthConstraints.removeValue(forKey: id)?.isActive = false
        }

        for action in descriptors {
            let button: UIButton
            if let existing = contextualButtons[action.id] {
                button = existing
                NavigationGlassButton.update(button, for: action)
            } else {
                button = NavigationGlassButton.make(for: action, onAction: onAction)
                contextualButtons[action.id] = button
            }
            updateMinimumWidth(for: action, button: button)
            updateFixedWidth(for: action, button: button)
        }

        var orderedViews: [UIView] = []
        if let back, let button = contextualButtons[back.id] {
            orderedViews.append(button)
        }
        orderedViews.append(innerActionsSpacer)
        orderedViews.append(contentsOf: actions.compactMap { contextualButtons[$0.id] })
        for (index, view) in orderedViews.enumerated() {
            if innerActions.arrangedSubviews.indices.contains(index),
               innerActions.arrangedSubviews[index] === view
            {
                continue
            }
            if innerActions.arrangedSubviews.contains(where: { $0 === view }) {
                innerActions.removeArrangedSubview(view)
            }
            innerActions.insertArrangedSubview(view, at: index)
        }
    }

    /// Changes the compact Home width in place while Back remains 48pt in either layout.
    private func updateFixedWidth(for action: NavigationActionDescriptor, button: UIButton) {
        NavigationGlassButton.setUsesRightRail(layoutMode == "right", for: action, button: button)
        guard let width = NavigationGlassButton.fixedWidth(for: action, usesRightRail: layoutMode == "right") else {
            contextualButtonFixedWidthConstraints.removeValue(forKey: action.id)?.isActive = false
            return
        }
        if let constraint = contextualButtonFixedWidthConstraints[action.id] {
            constraint.constant = width
        } else {
            let constraint = button.widthAnchor.constraint(equalToConstant: width)
            constraint.isActive = true
            contextualButtonFixedWidthConstraints[action.id] = constraint
        }
    }

    /// Tracks localized primary titles while keeping one width constraint per stable action.
    private func updateMinimumWidth(for action: NavigationActionDescriptor, button: UIButton) {
        guard action.id != "home", action.id != "back" else { return }
        let titleWidth = (action.label as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 14)]).width
        let minimumWidth = max(88, titleWidth + 24)
        if let constraint = contextualButtonWidthConstraints[action.id] {
            constraint.constant = minimumWidth
        } else {
            let constraint = button.widthAnchor.constraint(greaterThanOrEqualToConstant: minimumWidth)
            constraint.isActive = true
            contextualButtonWidthConstraints[action.id] = constraint
        }
    }

    /// Only mounted buttons consume touches; the gaps remain available to the route underneath.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit is UIControl ? hit : nil
    }
}
