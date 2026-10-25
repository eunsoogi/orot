@testable import Orot
import UIKit
import XCTest

final class ProgressIndicatorIntegrationTests: OrotFailFastTestCase {
    /// Exercise the production view across native mount, request completion and reuse, without disabling animation globally.
    @MainActor
    func testAnimationFollowsWindowAndRequestLifetime() throws {
        // Current iOS windows belong to a scene; frame-only construction is deprecated in iOS 26.
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first {
                $0.activationState == .foregroundActive
            },
        )
        let window = UIWindow(windowScene: scene)
        let indicator = AppProgressView(frame: .zero)
        defer { indicator.removeFromSuperview() }
        XCTAssertFalse(indicator.isAnimating)
        window.addSubview(indicator)
        XCTAssertTrue(indicator.isAnimating)
        indicator.active = false
        XCTAssertFalse(indicator.isAnimating)
        indicator.active = true
        XCTAssertTrue(indicator.isAnimating)
        indicator.removeFromSuperview()
        XCTAssertFalse(indicator.isAnimating)
        indicator.overrideUserInterfaceStyle = .dark
        indicator.updateTraitsIfNeeded()
        XCTAssertFalse(indicator.isAnimating)
        window.addSubview(indicator)
        XCTAssertTrue(indicator.isAnimating)
        indicator.removeFromSuperview()
        indicator.active = false
        window.addSubview(indicator)
        XCTAssertFalse(indicator.isAnimating)
        indicator.large = true
        XCTAssertEqual(indicator.style, .large)
        indicator.color = .red
        XCTAssertEqual(indicator.color, .red)
    }
}
