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
    private var renderedActions: [NavigationActionDescriptor] = []

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

    private func renderInnerActions(_ descriptors: [NavigationActionDescriptor], onAction: @escaping (String) -> Void) {
        for arrangedSubview in innerActions.arrangedSubviews {
            innerActions.removeArrangedSubview(arrangedSubview)
            arrangedSubview.removeFromSuperview()
        }
        if let back = descriptors.first(where: { $0.id == "back" }) {
            innerActions.addArrangedSubview(NavigationGlassButton.make(for: back, onAction: onAction))
        }
        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        innerActions.addArrangedSubview(spacer)
        for action in descriptors where action.id != "back" {
            let button = NavigationGlassButton.make(for: action, onAction: onAction)
            if action.id != "home" {
                // Preserve localized Generate/Cancel width and the 48pt primary target.
                // Measure the displayed 14pt title so localized primary labels are not clipped.
                let titleWidth = (action.label as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 14)]).width
                button.widthAnchor.constraint(greaterThanOrEqualToConstant: max(88, titleWidth + 24)).isActive = true
            }
            innerActions.addArrangedSubview(button)
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
