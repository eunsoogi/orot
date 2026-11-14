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

/// Exercises actual UIKit controls rather than the JavaScript adapter's event simulation.
enum GlassIconButtonTestAssertions {
    @MainActor
    static func assertNativeControls(in host: UIView) {
        for size: CGFloat in [44, 64] {
            let control = GlassIconButton(frame: CGRect(x: 8, y: 8, width: size, height: size))
            control.symbolName = "waveform"
            control.actionLabel = "합성 음성 버튼"
            control.actionHint = "실제 음성을 시작하지 않는 검사"
            control.actionTestID = "synthetic-native-glass-button"
            var calls = 0
            control.onAction = { _ in calls += 1 }
            host.addSubview(control)
            control.layoutIfNeeded()
            XCTAssertEqual(control.bounds.size, CGSize(width: size, height: size))
            XCTAssertEqual(control.alpha, 1)
            XCTAssertEqual(control.accessibilityLabel, "합성 음성 버튼")
            XCTAssertTrue(control.isAccessibilityElement)
            XCTAssertNotNil(control.configuration?.image)
            XCTAssertEqual(control.configuration?.cornerStyle, .capsule)
            XCTAssertTrue(control.hitTest(CGPoint(x: size / 2, y: size / 2), with: nil) === control)
            control.sendActions(for: .touchUpInside)
            XCTAssertEqual(calls, 1)
            control.disabled = true
            XCTAssertFalse(control.isEnabled)
            control.sendActions(for: .touchUpInside)
            XCTAssertEqual(calls, 1, "Queued activation must not run a disabled action")
            control.disabled = false
            control.sendActions(for: .touchUpInside)
            XCTAssertEqual(calls, 2)
            control.removeFromSuperview()
        }
    }
}
