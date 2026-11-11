import Foundation
#if canImport(CoreGraphics)
    import CoreGraphics
#endif

/// Compares screen-point AX frames with the four native UIWindow safe-area edges.
enum AppointmentViewportGeometry {
    struct Insets {
        let top: CGFloat
        let right: CGFloat
        let bottom: CGFloat
        let left: CGFloat
    }

    static func safeFrame(window: CGRect, insets: Insets) -> CGRect? {
        let edges = [insets.top, insets.right, insets.bottom, insets.left]
        guard valid(window), edges.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return nil }
        let safe = CGRect(x: window.minX + insets.left, y: window.minY + insets.top,
                          width: window.width - insets.left - insets.right,
                          height: window.height - insets.top - insets.bottom)
        return valid(safe) ? safe : nil
    }

    /// Reject regions outside their measured bounds; glyph-level or horizontal text truncation is not established here.
    static func accepts(window: CGRect, insets: Insets, scroll: CGRect, title: CGRect, toolbar: CGRect, minimumTitleHeight: CGFloat) -> Bool {
        guard let safe = safeFrame(window: window, insets: insets),
              valid(scroll), valid(title), valid(toolbar), minimumTitleHeight.isFinite,
              minimumTitleHeight > 0, title.height >= minimumTitleHeight else { return false }
        let tolerance: CGFloat = 0.5
        func contains(_ outer: CGRect, _ inner: CGRect) -> Bool {
            inner.minX >= outer.minX - tolerance && inner.minY >= outer.minY - tolerance &&
                inner.maxX <= outer.maxX + tolerance && inner.maxY <= outer.maxY + tolerance
        }
        return contains(safe, scroll) && contains(safe, title) && contains(safe, toolbar) &&
            contains(scroll, title) && !scroll.intersects(toolbar) && !title.intersects(toolbar)
    }

    /// Hit-target requirements are independent of the standalone probe's safe-area geometry.
    static func isUsableTarget(_ frame: CGRect, hittable: Bool) -> Bool {
        valid(frame) && frame.width >= 44 && frame.height >= 44 && hittable
    }

    /// Cached duplicates and samples from a previous launch cannot establish a current window.
    static func samplesBracketAX(launch: Double, axStart: Double, firstStart: Double, firstEnd: Double,
                                 secondStart: Double, secondEnd: Double, firstWindow: String, secondWindow: String) -> Bool
    {
        [launch, axStart, firstStart, firstEnd, secondStart, secondEnd].allSatisfy(\.isFinite) &&
            !firstWindow.isEmpty && firstWindow == secondWindow && launch <= firstStart && firstStart <= firstEnd &&
            firstEnd <= axStart && axStart <= secondStart && secondStart <= secondEnd && secondStart > firstStart
    }

    private static func valid(_ frame: CGRect) -> Bool {
        !frame.isNull && !frame.isInfinite && frame.width > 0 && frame.height > 0 &&
            [frame.minX, frame.minY, frame.maxX, frame.maxY].allSatisfy(\.isFinite)
    }
}
