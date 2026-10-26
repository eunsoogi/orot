import CoreGraphics

/// Compute one gesture from captured public frames, in UIKit points. Never combine later AX reads with these coordinates.
struct FormScrollGeometry {
    let application: CGRect
    let viewport: CGRect
    private static let coordinateTolerance: CGFloat = 0.0001

    init?(application: CGRect, scroll: CGRect, keyboard: CGRect?, reservedKeyboard: CGRect? = nil) {
        guard Self.valid(application), Self.valid(scroll) else { return nil }
        var visible = scroll.intersection(application)
        // A supplied reservation is a constraint, not an observation that the keyboard is currently present.
        for keyboard in [keyboard, reservedKeyboard].compactMap(\.self) {
            guard Self.valid(keyboard) else { return nil }
            visible.size.height = min(visible.maxY, keyboard.minY) - visible.minY
        }
        guard Self.valid(visible) else { return nil }
        self.application = application
        viewport = visible
    }

    /// Derive clipping from this evaluation; an explicit reserved frame is retained only for existing non-journal callers.
    static func current(application: CGRect, scroll: CGRect, keyboard: CGRect?, input: CGRect?, referenceSize: CGSize?, reservedKeyboard: CGRect? = nil) -> Self? {
        guard let geometry = Self(application: application, scroll: scroll, keyboard: keyboard, reservedKeyboard: reservedKeyboard) else { return nil }
        guard let keyboard, let input, let referenceSize else { return geometry }
        guard let reservation = geometry.keyboardReservation(keyboard, for: input, referenceSize: referenceSize) else { return nil }
        return Self(application: application, scroll: scroll, keyboard: keyboard, reservedKeyboard: reservation)
    }

    /// A focused AX frame can contain only the visible slice. Retain the previously observed height as a minimum, not an unproved full extent.
    func contains(_ target: CGRect, referenceSize: CGSize? = nil) -> Bool {
        guard Self.valid(target) else { return false }
        if let referenceSize {
            guard Self.valid(referenceSize), abs(target.width - referenceSize.width) <= Self.coordinateTolerance,
                  target.height + Self.coordinateTolerance >= referenceSize.height else { return false }
        }
        return target.minY >= viewport.minY - Self.coordinateTolerance && target.maxY <= viewport.maxY + Self.coordinateTolerance
    }

    /// The keyboard AX frame can omit its prediction surface. A bottom-clipped input supplies a stricter observed edge for the scroll constraint.
    func keyboardReservation(_ keyboard: CGRect, for target: CGRect, referenceSize: CGSize) -> CGRect? {
        guard Self.valid(keyboard), Self.valid(target), Self.valid(referenceSize),
              abs(target.width - referenceSize.width) <= Self.coordinateTolerance else { return nil }
        // Top clipping or an offscreen keyboard does not establish a new bottom boundary.
        guard keyboard.intersects(application), target.height + Self.coordinateTolerance < referenceSize.height,
              target.minY > viewport.minY + Self.coordinateTolerance else { return keyboard }
        let top = min(keyboard.minY, target.maxY)
        let reservation = CGRect(x: keyboard.minX, y: top, width: keyboard.width, height: keyboard.maxY - top)
        return Self.valid(reservation) ? reservation : nil
    }

    /// Scroll beside a focused editor; dragging within it can move its caret or scroll its text instead of the form.
    func horizontalPosition(outside target: CGRect) -> CGFloat? {
        guard Self.valid(target) else { return nil }
        let leftEnd = min(max(target.minX, viewport.minX), viewport.maxX)
        let rightStart = min(max(target.maxX, viewport.minX), viewport.maxX)
        let left = leftEnd - viewport.minX
        let right = viewport.maxX - rightStart
        guard max(left, right) > 0 else { return nil }
        let x = right >= left ? rightStart + right / 2 : viewport.minX + left / 2
        return (x - viewport.minX) / viewport.width
    }

    func gesture(target: CGRect?, towardTop: Bool, horizontalPosition: CGFloat, maximumScrollFraction: CGFloat = 0.45, verticalBounds: CGRect? = nil) -> (start: CGVector, end: CGVector)? {
        guard horizontalPosition.isFinite, (0 ... 1).contains(horizontalPosition),
              maximumScrollFraction.isFinite, maximumScrollFraction > 0, maximumScrollFraction <= 0.7 else { return nil }
        let measuredTarget = target.flatMap { Self.valid($0) ? $0 : nil }
        // Containment does not imply hittability under system chrome. If reveal
        // still needs a gesture, retain its search direction instead of oscillating
        // across the edge; measured clipping always takes precedence.
        let above = measuredTarget.map { contains($0) ? towardTop : $0.minY < viewport.minY } ?? towardTop
        // A keyboard can appear between AX observation and touch delivery. Stay beside
        // the same visible editor vertically too, without treating that band as visibility proof.
        var gestureViewport = viewport
        if let verticalBounds {
            guard Self.valid(verticalBounds) else { return nil }
            let top = max(viewport.minY, verticalBounds.minY)
            let bottom = min(viewport.maxY, verticalBounds.maxY)
            gestureViewport = CGRect(x: viewport.minX, y: top, width: viewport.width, height: bottom - top)
            guard Self.valid(gestureViewport) else { return nil }
        }
        let travelLimit = gestureViewport.height * maximumScrollFraction
        let overflow = measuredTarget.map { above ? viewport.minY - $0.minY : $0.maxY - viewport.maxY } ?? travelLimit
        // Virtualized lists can opt into longer travel while an offscreen row is being located.
        // The 70% ceiling keeps both endpoints inside the viewport from the existing 25%/75% origins.
        let distance = min(max(overflow + 8, 30), travelLimit)
        let x = viewport.minX + viewport.width * horizontalPosition - application.minX
        let y = gestureViewport.minY + gestureViewport.height * (above ? 0.25 : 0.75) - application.minY
        let endY = y + (above ? distance : -distance)
        guard [x, y, endY].allSatisfy(\.isFinite) else { return nil }
        return (CGVector(dx: x, dy: y), CGVector(dx: x, dy: endY))
    }

    /// Reference dimensions must be finite and positive before comparing observed extents.
    private static func valid(_ size: CGSize) -> Bool {
        size.width.isFinite && size.height.isFinite && size.width > 0 && size.height > 0
    }

    /// Frame edges must remain finite even when their individual components are finite.
    private static func valid(_ rect: CGRect) -> Bool {
        !rect.isNull && !rect.isInfinite && rect.size.width > 0 && rect.size.height > 0 &&
            [rect.origin.x, rect.origin.y, rect.width, rect.height, rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy(\.isFinite)
    }
}
