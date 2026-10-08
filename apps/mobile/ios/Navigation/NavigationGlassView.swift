import React
import UIKit

/// Adds a platform-native surface behind React Native navigation controls.
final class NavigationGlassSurfaceView: UIView {
    private let solidBackgroundView = UIView()
    private let effectView = UIVisualEffectView(effect: nil)
    private var observers: [NSObjectProtocol] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        configure()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configure()
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        effectView.frame = bounds
        solidBackgroundView.frame = bounds
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
            updateSurface()
        }
    }

    private func configure() {
        isAccessibilityElement = false
        clipsToBounds = false
        solidBackgroundView.isUserInteractionEnabled = false
        effectView.isUserInteractionEnabled = false
        solidBackgroundView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        effectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        insertSubview(solidBackgroundView, at: 0)
        insertSubview(effectView, at: 0)

        let center = NotificationCenter.default
        let settings = [
            UIAccessibility.reduceTransparencyStatusDidChangeNotification,
            UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
        ]
        observers = settings.map { name in
            center.addObserver(
                forName: name,
                object: nil,
                queue: .main,
            ) { [weak self] _ in
                self?.updateSurface()
            }
        }
        updateSurface()
    }

    private func updateSurface() {
        let needsOpaqueSurface =
            UIAccessibility.isReduceTransparencyEnabled ||
            UIAccessibility.isDarkerSystemColorsEnabled

        if needsOpaqueSurface {
            let isDarkAppearance = traitCollection.userInterfaceStyle == .dark
            effectView.effect = nil
            effectView.isHidden = true
            solidBackgroundView.isHidden = false
            solidBackgroundView.backgroundColor = isDarkAppearance ? .black : .white
            layer.borderColor = isDarkAppearance ? UIColor.white.cgColor : UIColor.black.cgColor
            layer.borderWidth = 1
            return
        }

        solidBackgroundView.isHidden = true
        effectView.isHidden = false
        layer.borderColor = UIColor.separator.cgColor
        layer.borderWidth = 0.5

        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect(style: .regular)
            glass.isInteractive = false
            effectView.effect = glass
        } else {
            // Material blur keeps controls legible on supported pre-glass systems.
            effectView.effect = UIBlurEffect(style: .systemMaterial)
        }
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
