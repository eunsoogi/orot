@testable import Orot
import UIKit
import XCTest

/// Verifies that reduced transparency uses an opaque system surface and restores native material.
enum ComposerGlassSurfaceTestAssertions {
    @MainActor
    static func assertReduceTransparencyFallback() {
        let surface = ComposerGlassSurfaceView()
        surface.updateMaterial(reduceTransparencyEnabled: true)
        XCTAssertNil(surface.effect)
        XCTAssertEqual(surface.backgroundColor, UIColor.secondarySystemBackground)

        surface.updateMaterial(reduceTransparencyEnabled: false)
        XCTAssertEqual(surface.backgroundColor, UIColor.clear)
        if #available(iOS 26.0, *) {
            XCTAssertTrue(surface.effect is UIGlassEffect)
        } else {
            XCTAssertTrue(surface.effect is UIBlurEffect)
        }
    }
}
