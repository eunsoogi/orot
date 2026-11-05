import CoreGraphics
import Foundation
import XCTest

/// Recognizes an active top-edge occlusion overlapping the measured right-side lane.
enum NavigationMeasuredReservation {
    static func matches(_ shared: [String: Any], window: CGRect, available: CGRect) -> Bool {
        guard abs(window.maxX - available.maxX - 84) < 0.5,
              let regions = shared["reservedRegions"] as? [[String: Any]] else { return false }
        return regions.contains { region in
            guard region["kind"] as? String == "occlusion", region["isActive"] as? Bool == true,
                  let frame = region["frame"] as? [String: Double],
                  let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"] else { return false }
            return x <= available.maxX + 0.5 && x + width >= window.maxX - 0.5 && y <= window.minY && y + height > window.minY
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
