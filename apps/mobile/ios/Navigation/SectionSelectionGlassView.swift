import CoreGraphics
import Foundation

// The bridge carries the logical origin. This geometry plan never consults
// an interrupted animation, a presentation frame, or a prior model frame.
struct SectionSelectionMotionPlan {
    let destination: CGRect
    let origin: CGRect?

    init?(target: NSDictionary?, allowsAnimation: Bool) {
        guard let target, let destination = Self.rectangle(target) else { return nil }
        self.destination = destination
        if allowsAnimation, target["animated"] as? Bool == true,
           let origin = Self.rectangle(target["origin"] as? NSDictionary), origin != destination {
            self.origin = origin
        } else {
            self.origin = nil
        }
    }

    private static func rectangle(_ fields: NSDictionary?) -> CGRect? {
        guard let x = fields?["x"] as? Double,
              let y = fields?["y"] as? Double,
              let width = fields?["width"] as? Double,
              let height = fields?["height"] as? Double,
              [x, y, width, height].allSatisfy(\.isFinite), width > 0, height > 0
        else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }
}

#if canImport(UIKit)
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
        if UIAccessibility.isReduceMotionEnabled {
            applyTarget(allowsAnimation: false)
        }
    }

    /// Commit the final geometry once, then animate the same layer from the
    /// explicitly owned tab rect. Position and bounds share one timing curve.
    private func applyTarget(allowsAnimation: Bool) {
        let layer = capsule.layer
        layer.removeAnimation(forKey: "sectionSelectionMotion")
        guard let plan = SectionSelectionMotionPlan(
            target: selectionTarget,
            allowsAnimation: allowsAnimation && !UIAccessibility.isReduceMotionEnabled && window != nil
        ) else {
            capsule.isHidden = true
            return
        }
        UIView.performWithoutAnimation {
            capsule.frame = plan.destination
            capsule.isHidden = false
            capsule.layoutIfNeeded()
        }
        guard let origin = plan.origin else { return }
        let duration = 0.24
        let position = CABasicAnimation(keyPath: "position")
        position.duration = duration
        position.fromValue = NSValue(cgPoint: CGPoint(x: origin.midX, y: origin.midY))
        position.toValue = NSValue(cgPoint: layer.position)
        let bounds = CABasicAnimation(keyPath: "bounds")
        bounds.duration = duration
        bounds.fromValue = NSValue(cgRect: CGRect(origin: layer.bounds.origin, size: origin.size))
        bounds.toValue = NSValue(cgRect: layer.bounds)
        let motion = CAAnimationGroup()
        motion.animations = [position, bounds]
        motion.duration = duration
        motion.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(motion, forKey: "sectionSelectionMotion")
    }
}

@objc(SectionSelectionGlassViewManager)
final class SectionSelectionGlassViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        SectionSelectionGlassView()
    }
}

#endif
