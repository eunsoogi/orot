import React
import UIKit

/// Uses the same SF Symbols as the native glass bar without rasterizing app text or device chrome.
final class AppSymbolView: UIImageView {
    @objc var symbolName: String = "" {
        didSet { updateSymbol() }
    }

    @objc var pointSize: NSNumber = 20 {
        didSet { updateSymbol() }
    }

    private func updateSymbol() {
        image = UIImage(
            systemName: symbolName,
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: CGFloat(truncating: pointSize),
                weight: .regular,
            ),
        )
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
