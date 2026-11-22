#if canImport(CoreGraphics)
    import CoreGraphics
#endif
import Foundation

/// Derive the usable literature viewport from observed frames in screen points.
enum LiteratureActionGeometry {
    enum Decision { case visible, up, down }

    static func viewport(window: CGRect, scroll: CGRect, dock: CGRect) -> CGRect? {
        guard valid(window), valid(scroll), valid(dock), window.intersects(dock) else { return nil }
        var visible = window.intersection(scroll)
        guard valid(visible), dock.minY > visible.minY else { return nil }
        visible.size.height = min(visible.maxY, dock.minY - 16) - visible.minY
        return valid(visible) ? visible : nil
    }

    static func decide(window: CGRect, scroll: CGRect, dock: CGRect, target: CGRect?) -> Decision? {
        guard let visible = viewport(window: window, scroll: scroll, dock: dock) else { return nil }
        // An offscreen identified action can be absent from AX until the page scrolls toward its tail.
        guard let target, !target.isEmpty else { return .up }
        guard valid(target),
              target.minX >= visible.minX, target.maxX <= visible.maxX,
              target.height <= visible.height else { return nil }
        if target.minY < visible.minY {
            return .down
        }
        if target.maxY > visible.maxY {
            return .up
        }
        return .visible
    }

    private static func valid(_ frame: CGRect) -> Bool {
        [frame.minX, frame.minY, frame.width, frame.height].allSatisfy(\.isFinite) && frame.width > 0 && frame.height > 0
    }
}
