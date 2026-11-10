import CoreGraphics
import Foundation

/// Derive Home's usable scroll viewport from the frames observed in the current window.
enum HomeMetricScrollGeometry {
    private static let edgeTolerance: CGFloat = 1
    private static let containmentTolerance: CGFloat = 0.001

    /// Trim an edge-aligned navigation overlay from the actual app, window, route and scroll intersection.
    static func unobscuredViewport(
        application: CGRect,
        window: CGRect,
        route: CGRect,
        scroll: CGRect,
        navigationOcclusion: CGRect,
    ) -> CGRect? {
        let observedFrames = [application, window, route, scroll, navigationOcclusion]
        guard observedFrames.allSatisfy(FormScrollGeometry.valid) else { return nil }

        var viewport = application.intersection(window).intersection(route).intersection(scroll)
        guard FormScrollGeometry.valid(viewport) else { return nil }
        guard viewport.intersects(navigationOcclusion) else { return viewport }

        let occlusion = viewport.intersection(navigationOcclusion)
        // The navigation layer must touch a viewport edge so the remaining safe area is one rectangle.
        if abs(occlusion.maxX - viewport.maxX) <= edgeTolerance,
           occlusion.minX > viewport.minX + containmentTolerance
        {
            viewport.size.width = occlusion.minX - viewport.minX
        } else if abs(occlusion.minX - viewport.minX) <= edgeTolerance,
                  occlusion.maxX < viewport.maxX - containmentTolerance
        {
            viewport.size.width = viewport.maxX - occlusion.maxX
            viewport.origin.x = occlusion.maxX
        } else if abs(occlusion.maxY - viewport.maxY) <= edgeTolerance,
                  occlusion.minY > viewport.minY + containmentTolerance
        {
            viewport.size.height = occlusion.minY - viewport.minY
        } else if abs(occlusion.minY - viewport.minY) <= edgeTolerance,
                  occlusion.maxY < viewport.maxY - containmentTolerance
        {
            viewport.size.height = viewport.maxY - occlusion.maxY
            viewport.origin.y = occlusion.maxY
        } else {
            return nil
        }

        return FormScrollGeometry.valid(viewport) ? viewport : nil
    }

    /// Require all four card edges inside the visible area; hittability alone can include an obscured edge.
    static func contains(_ target: CGRect, in viewport: CGRect) -> Bool {
        guard FormScrollGeometry.valid(target), FormScrollGeometry.valid(viewport) else { return false }
        return target.minX >= viewport.minX - containmentTolerance &&
            target.maxX <= viewport.maxX + containmentTolerance &&
            target.minY >= viewport.minY - containmentTolerance &&
            target.maxY <= viewport.maxY + containmentTolerance
    }
}
