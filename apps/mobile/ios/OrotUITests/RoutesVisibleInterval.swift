import CoreGraphics

/// Track continuous coverage in text-relative points, rejecting gaps and stalled scrolling.
enum RoutesVisibleInterval {
    /// Aim inside the containment range instead of overshooting a nearly viewport-sized paragraph.
    static func revealDistance(overflow: CGFloat, slack: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        min(viewportHeight * 0.4, max(1, overflow + max(0, slack) / 2))
    }

    static func advance(covered: CGFloat, start: CGFloat, end: CGFloat, height: CGFloat) -> CGFloat? {
        guard [covered, start, end, height].allSatisfy(\.isFinite), height > 0,
              covered >= 0, covered <= height, start >= 0, end <= height,
              end > start, start <= covered + 1, end > covered else { return nil }
        return end
    }
}
