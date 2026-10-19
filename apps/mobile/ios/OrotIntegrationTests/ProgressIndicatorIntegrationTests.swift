@testable import Orot
import UIKit
import XCTest

final class ProgressIndicatorIntegrationTests: OrotFailFastTestCase {
    /// Exercise the production view across native mount, request completion and reuse, without disabling animation globally.
    @MainActor
    func testAnimationFollowsWindowAndRequestLifetime() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
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
