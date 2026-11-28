import React
import UIKit

/// Paint only: React retains each tab's layout, accessibility and touch ownership.
final class SectionSelectionGlassView: UIView {
    private let capsule = ComposerGlassSurfaceView(maximumCornerRadius: nil)

    @objc var selectionTarget: NSDictionary? {
        didSet { applyTarget(allowsAnimation: true) }
    }

    init() {
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        clipsToBounds = true
        capsule.isHidden = true
        addSubview(capsule)
        NotificationCenter.default.addObserver(self, selector: #selector(reduceMotionChanged),
                                               name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("Created by its view manager")
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func reduceMotionChanged() {
        if UIAccessibility.isReduceMotionEnabled { applyTarget(allowsAnimation: false) }
    }

    /// Start at the in-flight presentation on interruption; never replace the
    /// visible material or crossfade two capsules. Layout-only updates snap.
    private func applyTarget(allowsAnimation: Bool) {
        guard let selectionTarget,
              let x = selectionTarget["x"] as? Double,
              let y = selectionTarget["y"] as? Double,
              let width = selectionTarget["width"] as? Double,
              let height = selectionTarget["height"] as? Double,
              [x, y, width, height].allSatisfy(\.isFinite), width > 0, height > 0
        else {
            capsule.layer.removeAllAnimations()
            capsule.isHidden = true
            return
        }
        let destination = CGRect(x: x, y: y, width: width, height: height)
        let animated = allowsAnimation && !UIAccessibility.isReduceMotionEnabled &&
            (selectionTarget["animated"] as? Bool == true) && !capsule.isHidden &&
            window != nil
        if animated, capsule.frame == destination { return }
        let from = capsule.layer.presentation()?.frame ?? capsule.frame
        capsule.layer.removeAllAnimations()
        UIView.performWithoutAnimation {
            capsule.frame = animated ? from : destination
            capsule.isHidden = false
            capsule.layoutIfNeeded()
        }
        guard animated else { return }
        UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState]) {
            self.capsule.frame = destination
            self.capsule.layoutIfNeeded()
        }
    }
}

@objc(SectionSelectionGlassViewManager)
final class SectionSelectionGlassViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool { true }
    override func view() -> UIView! { SectionSelectionGlassView() }
}
