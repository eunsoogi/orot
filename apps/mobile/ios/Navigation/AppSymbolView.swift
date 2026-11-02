import React
import UIKit

/// Shares the compact glyph scale while leaving every enclosing control's hit area independent.
enum AppSymbolSizing {
    static let compactPointSize: CGFloat = 18
    static let compactWeight: UIImage.SymbolWeight = .regular

    static func configuration(pointSize: CGFloat = compactPointSize) -> UIImage.SymbolConfiguration {
        UIImage.SymbolConfiguration(pointSize: pointSize, weight: compactWeight)
    }
}

/// Uses the app's compact SF Symbols without rasterizing text or device chrome.
final class AppSymbolView: UIImageView {
    @objc var symbolName: String = "" {
        didSet { updateSymbol() }
    }

    @objc var pointSize = NSNumber(value: Double(AppSymbolSizing.compactPointSize)) {
        didSet { updateSymbol() }
    }

    private func updateSymbol() {
        image = UIImage(systemName: symbolName, withConfiguration: AppSymbolSizing.configuration(
            pointSize: CGFloat(truncating: pointSize),
        ))
        contentMode = .scaleAspectFit
        isAccessibilityElement = false
    }
}

@objc(AppSymbolViewManager)
final class AppSymbolViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        AppSymbolView()
    }
}
