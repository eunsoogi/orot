import UIKit

/// A single material-backed droplet moves independently of the fixed, accessible tab targets.
final class NavigationSelectionGlass: UIVisualEffectView {
    private(set) var targetFrame = CGRect.zero

    init() {
        super.init(effect: nil)
        accessibilityIdentifier = "navigation-root-selection-indicator"
        isUserInteractionEnabled = false
        clipsToBounds = true
        layer.cornerCurve = .continuous
        updateMaterial()
        NotificationCenter.default.addObserver(self, selector: #selector(updateMaterial),
                                               name: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    /// Accessibility uses an opaque semantic selection, never a fake transparent glass substitute.
    @objc func updateMaterial() {
        if UIAccessibility.isReduceTransparencyEnabled {
            effect = nil
            backgroundColor = .systemGray4
        } else if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.tintColor = .systemBlue.withAlphaComponent(0.18)
            glass.isInteractive = false
            effect = glass
            backgroundColor = .clear
        } else {
            effect = UIBlurEffect(style: .systemMaterial)
            backgroundColor = NavigationGlassPalette.selectedRootTabBackground
        }
    }

    /// Sample an interrupted presentation before replacing animations; the model always rests circular.
    func move(to destination: CGRect, animated: Bool, vertical: Bool) {
        let previous = layer.presentation() ?? layer
        let startPosition = previous.position
        let startBounds = previous.bounds
        let startRadius = previous.cornerRadius
        let canAnimate = animated && !UIAccessibility.isReduceMotionEnabled && !targetFrame.isEmpty
        layer.removeAllAnimations()
        targetFrame = destination
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        frame = destination
        layer.cornerRadius = destination.width / 2
        CATransaction.commit()
        guard canAnimate else { return }

        let distance = hypot(layer.position.x - startPosition.x, layer.position.y - startPosition.y)
        guard distance > 0.5 else { return }
        // Modest elongation along travel gives the droplet a neck without obscuring adjacent controls.
        let stretch = min(destination.width * 0.3, distance * 0.16)
        let elongated = CGRect(origin: .zero, size: CGSize(
            width: destination.width + (vertical ? -stretch * 0.15 : stretch),
            height: destination.height + (vertical ? stretch : -stretch * 0.15),
        ))
        let midpoint = CGPoint(x: (startPosition.x + layer.position.x) / 2,
                               y: (startPosition.y + layer.position.y) / 2)
        let position = keyframes("position", [NSValue(cgPoint: startPosition), NSValue(cgPoint: midpoint), NSValue(cgPoint: layer.position)])
        let size = keyframes("bounds", [NSValue(cgRect: startBounds), NSValue(cgRect: elongated), NSValue(cgRect: layer.bounds)])
        let radius = keyframes("cornerRadius", [startRadius, min(elongated.width, elongated.height) / 2, destination.width / 2])
        let group = CAAnimationGroup()
        group.animations = [position, size, radius]
        group.duration = 0.32
        // Explicit model-state settlement makes cancellation, layout changes and rapid taps deterministic.
        layer.add(group, forKey: "navigation-droplet")
    }

    private func keyframes(_ key: String, _ values: [Any]) -> CAKeyframeAnimation {
        let animation = CAKeyframeAnimation(keyPath: key)
        animation.values = values
        animation.keyTimes = [0, 0.45, 1]
        animation.timingFunctions = [CAMediaTimingFunction(name: .easeOut), CAMediaTimingFunction(name: .easeInEaseOut)]
        return animation
    }
}

/// Weak window keys isolate independent scenes and release selection history with their window.
@MainActor
enum NavigationSelectionHistory {
    static let last = NSMapTable<UIWindow, NSString>(keyOptions: .weakMemory, valueOptions: .strongMemory)
}
