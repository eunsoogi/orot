import CoreGraphics

/// Track continuous coverage in text-relative points, rejecting gaps and stalled scrolling.
enum RoutesVisibleInterval {
    static func advance(covered: CGFloat, start: CGFloat, end: CGFloat, height: CGFloat) -> CGFloat? {
        guard [covered, start, end, height].allSatisfy(\.isFinite), height > 0,
              covered >= 0, covered <= height, start >= 0, end <= height,
              end > start, start <= covered + 1, end > covered else { return nil }
        return end
    }
}
