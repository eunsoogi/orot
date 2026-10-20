import React
import UIKit

/// Keeps one native surface mounted while root tabs or independent contextual actions change.
final class NavigationGlassSurfaceView: UIView {
    @objc var actions: NSArray = [] {
        didSet {
            let descriptors = actions.compactMap(NavigationActionDescriptor.init)
            guard descriptors != renderedActions else { return }
            render(descriptors)
        }
    }

    @objc var onAction: RCTBubblingEventBlock?
    private let rootBar = NavigationRootGlassBar()
    private let innerActions = UIStackView()
    private let innerActionsSpacer = UIView()
    private var renderedActions: [NavigationActionDescriptor] = []
    private var contextualButtons: [String: UIButton] = [:]
    private var contextualButtonWidthConstraints: [String: NSLayoutConstraint] = [:]

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
        innerActions.addArrangedSubview(innerActionsSpacer)
        // Match the native UI tests' shared toolbar identifier for contextual navigation actions.
        innerActions.accessibilityIdentifier = "navigation-toolbar"
        for view in [rootBar, innerActions] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
                view.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
                view.centerYAnchor.constraint(equalTo: centerYAnchor),
                view.heightAnchor.constraint(equalToConstant: view === rootBar ? 60 : 48),
            ])
        }
    }

    private func render(_ descriptors: [NavigationActionDescriptor]) {
        let wasRoot = renderedActions.contains(where: \.rootTab)
        let isRoot = descriptors.contains(where: \.rootTab)
        let animated = !renderedActions.isEmpty
        renderedActions = descriptors
        let dispatch: (String) -> Void = { [weak self] id in self?.onAction?(["id": id]) }
        // Selection updates retain the same indicator rather than fading recreated button backgrounds.
        if wasRoot, isRoot {
            rootBar.render(descriptors, animated: animated, onAction: dispatch)
            return
        }
        NavigationToolbarTransition.apply(to: self, animated: animated) {
            self.rootBar.isHidden = !isRoot
            self.innerActions.isHidden = isRoot
            if isRoot {
                self.rootBar.render(descriptors, animated: false, onAction: dispatch)
            } else {
                self.renderInnerActions(descriptors, onAction: dispatch)
            }
            self.layoutIfNeeded()
        }
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

@objc(NavigationGlassViewManager)
final class NavigationGlassViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        NavigationGlassSurfaceView()
    }
}
