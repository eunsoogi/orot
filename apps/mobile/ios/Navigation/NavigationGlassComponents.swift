import React
import UIKit

/// Hosts a persistent adapter's rail inside its owning full-window controller,
/// below UIKit presentations. Only controls consume hits; gaps reach the route.
final class NavigationWindowRailHost: UIView {
    private weak var owner: UIView?

    func mount(for owner: UIView, availableHeight: CGFloat, side: String = "right", width: CGFloat? = nil) -> UIView? {
        #if OROT_TESTS
            var observationReason = "missing-window-or-size"
            var observationRoot: UIView?
            var observationController: UIViewController?
            var observationTarget: CGRect?
            defer { NavigationRailMountTestObservation.mount(owner: owner, portal: self, controller: observationController, root: observationRoot, target: observationTarget, reason: observationReason) }
        #endif
        guard let window = owner.window, availableHeight > 0, owner.bounds.width > 0 else {
            removeFromSuperview()
            return nil
        }
        var responder: UIResponder? = owner.next
        while responder != nil, !(responder is UIViewController) {
            responder = responder?.next
        }
        guard let controller = responder as? UIViewController else {
            #if OROT_TESTS
                observationReason = "missing-controller"
            #endif
            return nil
        }
        let root = controller.view!
        #if OROT_TESTS
            observationRoot = root
            observationController = controller
        #endif
        // Do not inherit a former bottom bar's width while React is changing the surface props.
        let laneWidth = width ?? owner.bounds.width
        let windowFrame = CGRect(x: side == "left" ? window.bounds.minX : window.bounds.maxX - laneWidth, y: window.bounds.minY,
                                 width: laneWidth, height: min(availableHeight, window.bounds.height))
        let target = root.convert(windowFrame, from: window)
        #if OROT_TESTS
            observationTarget = target
            observationReason = "target-outside-root"
        #endif
        // A contracted controller is not a window host. Never move controls past
        // its touch ancestry merely because an overflow frame could be drawn.
        guard root.bounds.contains(target) else { return nil }
        if superview !== root {
            var branch = owner
            while branch.superview !== root {
                guard let parent = branch.superview else {
                    #if OROT_TESTS
                        observationReason = "owner-outside-root"
                    #endif
                    return nil
                }
                branch = parent
            }
            root.insertSubview(self, aboveSubview: branch)
        }
        self.owner = owner
        frame = target
        isHidden = !ownerIsVisible
        #if OROT_TESTS
            observationReason = "mounted"
        #endif
        return self
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        #if OROT_TESTS
            if let owner = owner as? NavigationGlassSurfaceView {
                NavigationRailMountTestObservation.layout(owner: owner, portal: self)
            }
        #endif
        (owner as? NavigationGlassSurfaceView)?.publishNavigationGeometry(from: self)
    }

    private var ownerIsVisible: Bool {
        guard let owner, owner.window === window else { return false }
        var ancestor: UIView? = owner
        while let view = ancestor {
            if view.isHidden || view.alpha <= 0.01 {
                return false
            }
            ancestor = view.superview
        }
        return true
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard ownerIsVisible else { return nil }
        let hit = super.hitTest(point, with: event)
        return hit is UIControl ? hit : nil
    }
}

/// The same fixed controls can bind to a local bottom surface or the window rail host.
enum NavigationRailConstraints {
    /// Separate page controls avoid duplicating the bottom bar's outer insets.
    static func configureBottomInsets(_ constraints: [NSLayoutConstraint], isPageDock: Bool) {
        constraints[4].constant = isPageDock ? 2 : 16
        constraints[5].constant = isPageDock ? -2 : -16
    }

    /// Keeps the compact rail width in sync without replacing mounted controls.
    static func updateFixedWidth(for action: NavigationActionDescriptor, button: UIButton, usesRightRail: Bool, constraints: inout [String: NSLayoutConstraint]) {
        NavigationGlassButton.setUsesRightRail(usesRightRail, for: action, button: button)
        guard let width = NavigationGlassButton.fixedWidth(for: action, usesRightRail: usesRightRail, traits: button.traitCollection) else {
            constraints.removeValue(forKey: action.id)?.isActive = false
            return
        }
        if let constraint = constraints[action.id] {
            constraint.constant = width
        } else {
            let constraint = button.widthAnchor.constraint(equalToConstant: width)
            constraint.isActive = true
            constraints[action.id] = constraint
        }
    }

    /// One flexible gap separates Back from retained trailing actions in either axis.
    static func configureFlexibleSpace(_ spacer: UIView, in stack: UIStackView) {
        // The contextual toolbar remains identifiable before its first action arrives.
        stack.accessibilityIdentifier = "navigation-toolbar"
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        spacer.setContentHuggingPriority(.defaultLow, for: .vertical)
        spacer.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        stack.addArrangedSubview(spacer)
    }

    static func make(rootBar: NavigationRootGlassBar, innerActions: UIStackView, host: UIView) -> [NSLayoutConstraint] {
        [
            rootBar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            rootBar.widthAnchor.constraint(equalToConstant: NavigationRootGlassBar.exteriorWidth),
            rootBar.heightAnchor.constraint(equalToConstant: NavigationRootGlassBar.railHeight),
            rootBar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            innerActions.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            innerActions.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            innerActions.topAnchor.constraint(equalTo: host.topAnchor),
            innerActions.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ]
    }
}

/// Measures configured UIKit controls, including the native minimum and button insets.
enum NavigationPageMetrics {
    static func publish(_ request: NSDictionary, width: CGFloat, traits: UITraitCollection, lastKey: inout String, emit: RCTDirectEventBlock?) {
        guard let emit, let metrics = payload(request, width: width, traits: traits, lastKey: &lastKey) else { return }
        emit(metrics)
    }

    static func payload(_ request: NSDictionary, width: CGFloat, traits: UITraitCollection, lastKey: inout String) -> [String: Any]? {
        guard width > 0, let revision = request["revision"] as? String, let values = request["actions"] as? [Any] else { return nil }
        let key = "\(revision):\(width):\(traits.preferredContentSizeCategory.rawValue)"
        guard key != lastKey else { return nil }
        lastKey = key
        let actions = values.compactMap(NavigationActionDescriptor.init)
        let standard = UITraitCollection(traitsFrom: [traits, UITraitCollection(preferredContentSizeCategory: .large)])
        return ["revision": revision, "width": width, "category": traits.preferredContentSizeCategory.rawValue,
                "widths": actions.map { $0.layoutWidth ?? NavigationTextMetrics.width(for: $0, traits: traits) },
                "baselineWidths": actions.map { NavigationTextMetrics.width(for: $0, traits: standard) },
                "heights": actions.map { NavigationTextMetrics.height(for: $0, traits: traits) }]
    }
}

enum NavigationRootTabContent {
    /// Fixed 18pt glyphs preserve the tab's padding and 52pt touch target.
    static func make(
        label: String,
        symbolName: String,
        testID: String,
        foregroundColor: UIColor,
        titleSize: CGFloat = 12,
    ) -> UIStackView {
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        // Leave visible separation even when XCTest rounds native child frames outward.
        stack.spacing = 4
        stack.isUserInteractionEnabled = false

        let icon = UIImageView(
            image: UIImage(
                systemName: symbolName,
                withConfiguration: AppSymbolSizing.configuration(),
            ),
        )
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.contentMode = .scaleAspectFit
        icon.tintColor = foregroundColor
        icon.isAccessibilityElement = false
        icon.accessibilityIdentifier = "\(testID)-UIImageView"

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = label
        title.font = NavigationTextMetrics.font(size: titleSize, traits: UITraitCollection.current)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.textColor = foregroundColor
        title.numberOfLines = 1
        title.isAccessibilityElement = false
        title.accessibilityIdentifier = "\(testID)-UILabel"

        stack.addArrangedSubview(icon)
        stack.addArrangedSubview(title)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
            icon.heightAnchor.constraint(equalToConstant: AppSymbolSizing.compactPointSize),
        ])
        return stack
    }
}

/// Shares semantic native colors between grouped tabs and independent contextual controls.
enum NavigationGlassPalette {
    /// Color values use 8-bit channels; UIColor expects normalized 0...1 components.
    static func rgbColor(red: Int, green: Int, blue: Int) -> UIColor {
        UIColor(
            red: CGFloat(red) / 255,
            green: CGFloat(green) / 255,
            blue: CGFloat(blue) / 255,
            alpha: 1,
        )
    }

    static let primaryTint = UIColor { traits in
        // Darken the brand tint in higher-contrast settings while retaining its hue.
        traits.accessibilityContrast == .high
            ? rgbColor(red: 31, green: 93, blue: 184)
            : rgbColor(red: 49, green: 130, blue: 246)
    }

    static let selectedRootTabBackground = UIColor.secondarySystemFill
    static let selectedRootTabForeground = UIColor { traits in
        // Keep small selected labels readable by adapting the brand hue to appearance and contrast.
        let color: (Int, Int, Int) = if traits.userInterfaceStyle == .dark {
            traits.accessibilityContrast == .high ? (179, 208, 255) : (141, 187, 255)
        } else {
            (31, 93, 184)
        }
        return rgbColor(red: color.0, green: color.1, blue: color.2)
    }
}
