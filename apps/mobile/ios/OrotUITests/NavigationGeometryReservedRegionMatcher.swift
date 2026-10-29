import Foundation

/// Shares the decoded geometry values and reservation comparison with host-runnable regression tests.
enum NavigationGeometryReservedRegionMatcher {
    /// Rectangles use the UIWindow point coordinate system reported by the native observations.
    struct GeometryRect: Decodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double

        init(x: Double, y: Double, width: Double, height: Double) {
            self.x = x
            self.y = y
            self.width = width
            self.height = height
        }
    }

    /// Retains all four UIKit inset values so safe-area and reservation margins use one tolerance.
    struct GeometryInsets: Decodable {
        let top: Double
        let right: Double
        let bottom: Double
        let left: Double

        init(top: Double, right: Double, bottom: Double, left: Double) {
            self.top = top
            self.right = right
            self.bottom = bottom
            self.left = left
        }
    }

    /// Keeps the identity and every measured property of one system-reserved region.
    struct GeometryRegion: Decodable {
        let id: String
        let kind: String
        let frame: GeometryRect
        let margins: GeometryInsets
        let isActive: Bool

        init(id: String, kind: String, frame: GeometryRect, margins: GeometryInsets, isActive: Bool) {
            self.id = id
            self.kind = kind
            self.frame = frame
            self.margins = margins
            self.isActive = isActive
        }
    }

    /// Decodes and compares the shared native and public UIKit measurement payload.
    struct GeometryPayload: Decodable {
        let windowBounds: GeometryRect
        let safeAreaInsets: GeometryInsets
        let reservedRegionsSupported: Bool
        let reservedRegions: [GeometryRegion]

        init(windowBounds: GeometryRect, safeAreaInsets: GeometryInsets,
             reservedRegionsSupported: Bool, reservedRegions: [GeometryRegion])
        {
            self.windowBounds = windowBounds
            self.safeAreaInsets = safeAreaInsets
            self.reservedRegionsSupported = reservedRegionsSupported
            self.reservedRegions = reservedRegions
        }

        /// Compares the shared geometry fields while allowing half-point UIKit rounding.
        func matches(_ other: GeometryPayload) -> Bool {
            NavigationGeometryReservedRegionMatcher.rectMatches(windowBounds, other.windowBounds)
                && NavigationGeometryReservedRegionMatcher.insetsMatch(safeAreaInsets, other.safeAreaInsets)
                && reservedRegionsSupported == other.reservedRegionsSupported
                && NavigationGeometryReservedRegionMatcher.regionsMatch(reservedRegions, other.reservedRegions)
        }
    }

    /// Allows half-point floating rounding while preserving the measured frame contract.
    static func rectMatches(_ first: GeometryRect, _ second: GeometryRect) -> Bool {
        abs(first.x - second.x) <= 0.5 && abs(first.y - second.y) <= 0.5
            && abs(first.width - second.width) <= 0.5 && abs(first.height - second.height) <= 0.5
    }

    /// Applies the same half-point boundary to safe-area and reserved-region margins.
    static func insetsMatch(_ first: GeometryInsets, _ second: GeometryInsets) -> Bool {
        abs(first.top - second.top) <= 0.5 && abs(first.right - second.right) <= 0.5
            && abs(first.bottom - second.bottom) <= 0.5 && abs(first.left - second.left) <= 0.5
    }

    /// Finds an order-independent one-to-one match when UIKit reuses an id and kind across regions.
    static func regionsMatch(_ first: [GeometryRegion], _ second: [GeometryRegion]) -> Bool {
        guard first.count == second.count else { return false }

        // Build edges from the full contract before assigning either side of the reservation list.
        let candidates = first.map { region in
            second.indices.filter { regionMatches(region, second[$0]) }
        }
        var assignedFirstBySecond = [Int?](repeating: nil, count: second.count)

        for firstIndex in first.indices {
            var visitedSecond = Array(repeating: false, count: second.count)
            guard assign(firstIndex, candidates: candidates, assignedFirstBySecond: &assignedFirstBySecond,
                         visitedSecond: &visitedSecond) else { return false }
        }
        return true
    }

    private static func regionMatches(_ first: GeometryRegion, _ second: GeometryRegion) -> Bool {
        first.id == second.id && first.kind == second.kind && first.isActive == second.isActive
            && rectMatches(first.frame, second.frame) && insetsMatch(first.margins, second.margins)
    }

    /// Reassigns earlier candidates when a later region has fewer half-point-compatible partners.
    private static func assign(_ firstIndex: Int, candidates: [[Int]],
                               assignedFirstBySecond: inout [Int?], visitedSecond: inout [Bool]) -> Bool
    {
        for secondIndex in candidates[firstIndex] where !visitedSecond[secondIndex] {
            visitedSecond[secondIndex] = true
            if let previousFirst = assignedFirstBySecond[secondIndex] {
                guard assign(previousFirst, candidates: candidates, assignedFirstBySecond: &assignedFirstBySecond,
                             visitedSecond: &visitedSecond) else { continue }
            }
            assignedFirstBySecond[secondIndex] = firstIndex
            return true
        }
        return false
    }
}
