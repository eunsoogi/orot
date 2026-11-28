import CoreGraphics
import Foundation

/// The bridge carries the actual previous tab in the current row's coordinates.
struct SectionSelectionMotionPlan: Equatable {
    let destination: CGRect
    let origin: CGRect?

    init?(target: NSDictionary?, allowsAnimation: Bool) {
        guard let target, let destination = Self.rectangle(target) else { return nil }
        self.destination = destination
        if allowsAnimation, target["animated"] as? Bool == true,
           let origin = Self.rectangle(target["origin"] as? NSDictionary), origin != destination
        {
            self.origin = origin
        } else {
            origin = nil
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

/// Interpolate the actual material view rather than animating the backing
/// layer to a frame UIKit has already moved its visual effect into.
struct SectionSelectionSlide {
    let origin: CGRect
    let destination: CGRect
    static let duration: TimeInterval = 0.28

    func frame(elapsed: TimeInterval) -> CGRect {
        let linear = CGFloat(min(max(elapsed / Self.duration, 0), 1))
        let progress = linear * linear * (3 - 2 * linear)
        func between(_ from: CGFloat, _ to: CGFloat) -> CGFloat {
            from + (to - from) * progress
        }
        return CGRect(
            x: between(origin.minX, destination.minX),
            y: between(origin.minY, destination.minY),
            width: between(origin.width, destination.width),
            height: between(origin.height, destination.height),
        )
    }
}

#if canImport(UIKit)
    import React
    import UIKit

    /// Paint only: React retains each tab's layout, accessibility and touch ownership.
    final class SectionSelectionGlassView: UIView {
        private let capsule = ComposerGlassSurfaceView(maximumCornerRadius: nil)
        private let tickTarget = SectionSelectionTickTarget()
        private var applied: SectionSelectionMotionPlan?
        private var slide: SectionSelectionSlide?
        private var displayLink: CADisplayLink?
        private var startTime: CFTimeInterval?

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
            tickTarget.owner = self
            NotificationCenter.default.addObserver(self, selector: #selector(reduceMotionChanged),
                                                   name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
        }

        @available(*, unavailable)
        required init?(coder _: NSCoder) {
            fatalError("Created by its view manager")
        }

        deinit { NotificationCenter.default.removeObserver(self) }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil {
                stopSlide()
                applied = nil
            } else {
                applyTarget(allowsAnimation: true)
            }
        }

        @objc private func reduceMotionChanged() {
            if UIAccessibility.isReduceMotionEnabled {
                applyTarget(allowsAnimation: false)
            }
        }

        private func applyTarget(allowsAnimation: Bool) {
            guard window != nil else { return }
            guard let plan = SectionSelectionMotionPlan(
                target: selectionTarget,
                allowsAnimation: allowsAnimation && !UIAccessibility.isReduceMotionEnabled,
            ) else {
                stopSlide()
                applied = nil
                capsule.isHidden = true
                return
            }
            // Fabric can re-deliver an equivalent prop while reconciling the row.
            guard plan != applied else { return }
            applied = plan
            // Interrupt only an animation to the immediately previous tab;
            // otherwise render from the explicit origin carried by this tap.
            let origin = plan.origin.map { slide?.destination == $0 ? capsule.frame : $0 }
            stopSlide()
            capsule.isHidden = false
            guard let origin, origin != plan.destination else {
                moveMaterial(to: plan.destination)
                return
            }
            moveMaterial(to: origin)
            slide = SectionSelectionSlide(origin: origin, destination: plan.destination)
            let link = CADisplayLink(target: tickTarget, selector: #selector(SectionSelectionTickTarget.advance(_:)))
            link.add(to: .main, forMode: .common)
            displayLink = link
        }

        fileprivate func advance(_ link: CADisplayLink) {
            guard let slide else {
                link.invalidate()
                return
            }
            let start = startTime ?? link.timestamp
            startTime = start
            let elapsed = link.timestamp - start
            if elapsed >= SectionSelectionSlide.duration {
                moveMaterial(to: slide.destination)
                stopSlide()
            } else {
                moveMaterial(to: slide.frame(elapsed: elapsed))
            }
        }

        private func moveMaterial(to frame: CGRect) {
            UIView.performWithoutAnimation {
                capsule.frame = frame
                capsule.layoutIfNeeded()
            }
        }

        private func stopSlide() {
            displayLink?.invalidate()
            displayLink = nil
            slide = nil
            startTime = nil
        }
    }

    /// The run loop holds this proxy, not the tab row. Detach stops normal
    /// motion; a remaining callback cannot keep an orphaned row alive.
    @MainActor
    private final class SectionSelectionTickTarget: NSObject {
        weak var owner: SectionSelectionGlassView?

        @objc func advance(_ link: CADisplayLink) {
            guard let owner else {
                link.invalidate()
                return
            }
            owner.advance(link)
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
