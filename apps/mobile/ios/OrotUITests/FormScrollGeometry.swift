import CoreGraphics

/// Compute one gesture from captured public frames, in UIKit points. Never combine later AX reads with these coordinates.
struct FormScrollGeometry {
    let application: CGRect
    let viewport: CGRect
    private static let coordinateTolerance: CGFloat = 0.0001

    init?(application: CGRect, scroll: CGRect, keyboard: CGRect?) {
        guard Self.valid(application), Self.valid(scroll) else { return nil }
        var visible = scroll.intersection(application)
        if let keyboard {
            guard Self.valid(keyboard) else { return nil }
            visible.size.height = min(visible.maxY, keyboard.minY) - visible.minY
        }
        guard Self.valid(visible) else { return nil }
        self.application = application
        viewport = visible
    }

    /// Retain the existing vertical containment tolerance for AX rounding; hittability remains the caller's separate observation.
    func contains(_ target: CGRect) -> Bool {
        Self.valid(target) && target.minY >= viewport.minY - Self.coordinateTolerance && target.maxY <= viewport.maxY + Self.coordinateTolerance
    }

    func gesture(target: CGRect?, towardTop: Bool, horizontalPosition: CGFloat, maximumScrollFraction: CGFloat = 0.45) -> (start: CGVector, end: CGVector)? {
        guard horizontalPosition.isFinite, (0 ... 1).contains(horizontalPosition),
              maximumScrollFraction.isFinite, maximumScrollFraction > 0, maximumScrollFraction <= 0.7 else { return nil }
        let measuredTarget = target.flatMap { Self.valid($0) ? $0 : nil }
        // Containment does not imply hittability under system chrome. If reveal
        // still needs a gesture, retain its search direction instead of oscillating
        // across the edge; measured clipping always takes precedence.
        let above = measuredTarget.map { contains($0) ? towardTop : $0.minY < viewport.minY } ?? towardTop
        let travelLimit = viewport.height * maximumScrollFraction
        let overflow = measuredTarget.map { above ? viewport.minY - $0.minY : $0.maxY - viewport.maxY } ?? travelLimit
        // Virtualized lists can opt into longer travel while an offscreen row is being located.
        // The 70% ceiling keeps both endpoints inside the viewport from the existing 25%/75% origins.
        let distance = min(max(overflow + 8, 30), travelLimit)
        let x = viewport.minX + viewport.width * horizontalPosition - application.minX
        let y = viewport.minY + viewport.height * (above ? 0.25 : 0.75) - application.minY
        let endY = y + (above ? distance : -distance)
        guard [x, y, endY].allSatisfy(\.isFinite) else { return nil }
        return (CGVector(dx: x, dy: y), CGVector(dx: x, dy: endY))
    }

    /// Positive dimensions alone admit infinity. Check derived edges too, because finite components can overflow when added.
    private static func valid(_ rect: CGRect) -> Bool {
        !rect.isNull && !rect.isInfinite && rect.size.width > 0 && rect.size.height > 0 &&
            [rect.origin.x, rect.origin.y, rect.width, rect.height, rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy(\.isFinite)
    }
}
