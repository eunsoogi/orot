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
    @objc var pageMetricsRequest: NSDictionary = [:] {
        didSet { setNeedsLayout() }
    }

    @objc var onPageMetrics: RCTDirectEventBlock? {
        didSet { setNeedsLayout() }
    }

    var lastPageMetricsKey = ""
    @objc var isPageDock: Bool = false {
        didSet { updatePresentation() }
    }

    /// Overlay layout only invalidates measurement; the actual parent's callback still owns window conversion.
    @objc var geometryLayoutRevision: String? {
        didSet { (rootBar.isHidden ? innerActions as UIView : rootBar).superview?.setNeedsLayout() }
    }

    @objc var layoutMode: String = "bottom" {
        didSet {
            updatePresentation()
            renderCurrentComposition(animated: false)
        }
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

    @objc var bottomHeight: CGFloat = 0 {
        didSet { updatePresentation() }
    }

    let rootBar = NavigationRootGlassBar()
    private let windowRailHost = NavigationWindowRailHost()
    override var isHidden: Bool {
        didSet { windowRailHost.isHidden = isHidden }
    }

    let innerActions = UIStackView()
    // The shared renderer keeps its flexible gap behind root tabs when Back is split out.
    let innerActionsSpacer = UIView()
    var renderedActions: [NavigationActionDescriptor] = []
    private var actionDispatcher: ((String) -> Void)?
    var contextualButtons: [String: UIButton] = [:]
    var contextualButtonWidthConstraints: [String: NSLayoutConstraint] = [:]
    var contextualButtonFixedWidthConstraints: [String: NSLayoutConstraint] = [:]
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
        NavigationRailConstraints.configureFlexibleSpace(innerActionsSpacer, in: innerActions)
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
        railPlacementConstraints = NavigationRailConstraints.make(rootBar: rootBar, innerActions: innerActions, host: self)
        observeNavigationTextSize()
        updatePresentation()
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updatePresentation()
    }

    override func layoutSubviews() {
        let host = layoutMode != "bottom" ? windowRailHost.mount(for: self, availableHeight: railAvailableHeight, side: layoutMode, width: NavigationRootGlassBar.exteriorWidth + railRightInset) : nil
        if rootBar.superview !== (host ?? self) {
            updatePresentation()
        }
        super.layoutSubviews()
        NavigationPageMetrics.publish(pageMetricsRequest, width: bounds.width, traits: traitCollection, lastKey: &lastPageMetricsKey, emit: onPageMetrics)
        #if OROT_TESTS
            NavigationRailMountTestObservation.layout(owner: self, portal: windowRailHost)
        #endif
        publishNavigationGeometry(from: self)
    }

    func render(_ descriptors: [NavigationActionDescriptor]) {
        innerActions.accessibilityIdentifier = descriptors.allSatisfy { $0.id.hasPrefix("page:") } ? "navigation-page-action-toolbar" : "navigation-toolbar"
        let wasRoot = renderedActions.contains(where: \.rootTab)
        let isRoot = descriptors.contains(where: \.rootTab)
        let animated = !renderedActions.isEmpty
        renderedActions = descriptors
        let dispatch: (String) -> Void = { [weak self] id in self?.onAction?(["id": id]) }
        actionDispatcher = dispatch
        // Selection updates retain the same indicator rather than fading recreated button backgrounds.
        if wasRoot, isRoot {
            updatePresentation()
            renderCurrentComposition(animated: animated)
            finishRendering()
            return
        }
        NavigationToolbarTransition.apply(to: self, animated: animated) {
            self.updatePresentation()
            self.renderCurrentComposition(animated: false)
            self.finishRendering()
        }
    }

    /// Keeps contextual Back sizing separate from the shared root-tab material in every layout.
    private func renderCurrentComposition(animated: Bool) {
        guard let actionDispatcher else { return }
        let hasRootTabs = renderedActions.contains(where: \.rootTab)
        guard hasRootTabs else {
            renderInnerActions(renderedActions, onAction: actionDispatcher)
            return
        }

        let contextualBack = renderedActions.filter { $0.id == "back" }
        let rootActions = renderedActions.filter { $0.id != "back" }
        rootBar.render(rootActions, animated: animated, onAction: actionDispatcher)
        // Action composition determines the rail height before its parent resolves frames.
        updatePresentation()
        renderInnerActions(contextualBack, onAction: actionDispatcher)
    }

    /// Reparents existing controls into a window-coordinate host without changing action identity.
    private func updatePresentation() {
        let usesRightRail = layoutMode != "bottom"
        let hasRootTabs = renderedActions.contains(where: \.rootTab)
        let backAction = renderedActions.first { $0.id == "back" }
        let showsBottomBack = !usesRightRail && hasRootTabs && backAction != nil
        NSLayoutConstraint.deactivate(bottomPlacementConstraints + railPlacementConstraints)
        NavigationRailConstraints.configureBottomInsets(bottomPlacementConstraints, isPageDock: isPageDock)
        // Reserve the measured contextual target and normal toolbar gap before the tab material.
        let measuredBackWidth = backAction.flatMap {
            NavigationGlassButton.fixedWidth(for: $0, usesRightRail: false, traits: traitCollection)
        } ?? 48
        bottomPlacementConstraints[0].constant = 16 + (showsBottomBack ? measuredBackWidth + innerActions.spacing : 0)
        bottomPlacementConstraints[3].constant = max(60, bottomHeight)
        bottomPlacementConstraints[7].constant = max(48, bottomHeight)
        let host = usesRightRail ? windowRailHost.mount(for: self, availableHeight: railAvailableHeight, side: layoutMode, width: NavigationRootGlassBar.exteriorWidth + railRightInset) ?? self : self
        if rootBar.superview !== host {
            for view in [rootBar, innerActions] {
                host.addSubview(view)
            }
            railPlacementConstraints = NavigationRailConstraints.make(rootBar: rootBar, innerActions: innerActions, host: host)
        }
        if host === self {
            windowRailHost.removeFromSuperview()
        }
        bottomPlacementConstraints.forEach { $0.isActive = !usesRightRail }
        railPlacementConstraints.forEach { $0.isActive = usesRightRail }
        // Mirror the measured lane for left-side multitasking; the legacy inset property is edge-relative.
        railPlacementConstraints[0].constant = layoutMode == "left" ? -max(0, host.bounds.width - NavigationRootGlassBar.exteriorWidth - railRightInset) : -railRightInset
        // Recompute height after composition changes; retain each target and bottom clearance.
        railPlacementConstraints[2].constant = rootBar.railHeight
        // Anchor the root surface to the usable lane bottom, not the screen edge.
        railPlacementConstraints[3].constant = -railBottomInset
        railPlacementConstraints[4].constant = layoutMode == "left" ? railRightInset : 0
        railPlacementConstraints[5].constant = layoutMode == "left" ? -max(0, host.bounds.width - NavigationRootGlassBar.exteriorWidth - railRightInset) : -railRightInset
        if usesRightRail,
           renderedActions.contains(where: \.rootTab),
           renderedActions.contains(where: { $0.id == "back" })
        {
            // Anchor Back 4pt above the uncompressed root bar, including any page-action offset.
            let rootTopY = host.bounds.height - railBottomInset - rootBar.railHeight
            railPlacementConstraints[6].constant =
                rootTopY -
                NavigationRootGlassBar.contextualBackGroupHeight
        } else {
            railPlacementConstraints[6].constant = railTopInset
        }
        railPlacementConstraints[7].constant = -railBottomInset
        rootBar.setVerticalLayout(usesRightRail)
        rootBar.setBottomHeight(max(60, bottomHeight))
        innerActions.axis = usesRightRail ? .vertical : .horizontal
        innerActions.alignment = usesRightRail ? .fill : .center
        for (id, button) in contextualButtons {
            guard let action = renderedActions.first(where: { $0.id == id }) else { continue }
            NavigationGlassButton.setHeight(bottomHeight, for: action, button: button, usesRightRail: usesRightRail)
            NavigationRailConstraints.updateFixedWidth(for: action, button: button, usesRightRail: usesRightRail, constraints: &contextualButtonFixedWidthConstraints)
        }
        let showsContextualBack = hasRootTabs && backAction != nil
        rootBar.isHidden = !hasRootTabs
        innerActions.isHidden = !showsContextualBack && rootBar.isHidden == false
        if showsContextualBack {
            // Keep root targets above the flexible contextual gap, which overlaps their material.
            host.bringSubviewToFront(rootBar)
        }
        host.setNeedsLayout()
        setNeedsLayout()
    }

    /// Only mounted buttons consume touches; the gaps remain available to the route underneath.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit is UIControl ? hit : nil
    }
}
