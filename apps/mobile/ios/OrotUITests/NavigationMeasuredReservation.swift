import CoreGraphics
import Foundation
import XCTest

/// Limits the measured offset to the two observed full-width side reservations.
enum NavigationMeasuredReservation {
    static func matches(_ shared: [String: Any], window: CGRect, available: CGRect) -> Bool {
        guard abs(window.maxX - available.maxX - 84) < 0.5,
              let regions = shared["reservedRegions"] as? [[String: Any]] else { return false }
        return regions.contains { region in
            guard region["kind"] as? String == "occlusion", region["isActive"] as? Bool == true,
                  let frame = region["frame"] as? [String: Double],
                  let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"] else { return false }
            return abs(x - available.maxX) < 0.5 && abs(y - window.minY) < 0.5 && abs(width - 84) < 0.5 &&
                (abs(height - 124) < 0.5 || abs(height - 174) < 0.5)
        }
    }
}

extension NavigationGeometryUITestConditions {
    /// Compares native root and contextual rail/control frames in window coordinates.
    static func assertSameRailCenter(_ root: CGRect, contextualFrames: [CGRect]) {
        for frame in contextualFrames {
            XCTAssertEqual(root.midX, frame.midX, accuracy: 0.5,
                           "Root and contextual controls must share the measured UIWindow lane center")
        }
    }
}
