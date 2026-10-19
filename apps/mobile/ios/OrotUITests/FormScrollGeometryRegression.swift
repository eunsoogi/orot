import XCTest

/// Preserve the original export case while exercising invalid AX frames before it touches the app.
enum FormScrollGeometryRegression {
    static func verify() throws {
        let app = CGRect(x: 0, y: 0, width: 375, height: 667)
        let scroll = CGRect(x: 0, y: 400, width: 375, height: 300)
        let geometry = try XCTUnwrap(FormScrollGeometry(application: app, scroll: scroll, keyboard: nil))
        XCTAssertEqual(geometry.viewport, CGRect(x: 0, y: 400, width: 375, height: 267))
        XCTAssertTrue(geometry.contains(CGRect(x: 0, y: 410, width: 375, height: 44)))
        XCTAssertFalse(geometry.contains(CGRect(x: 0, y: 640, width: 375, height: 44)))

        // Missing, non-finite and overflowing frames must never become infinite drag offsets.
        let invalid: [CGRect] = [.null, .infinite, .zero,
                                 CGRect(x: CGFloat.nan, y: 0, width: 375, height: 267),
                                 CGRect(x: 0, y: 400, width: -375, height: 267),
                                 CGRect(x: 0, y: 400, width: 375, height: -267),
                                 CGRect(x: 0, y: -CGFloat.infinity, width: 375, height: CGFloat.infinity),
                                 CGRect(x: 0, y: CGFloat.greatestFiniteMagnitude, width: 375, height: CGFloat.greatestFiniteMagnitude)]
        for frame in invalid {
            XCTAssertNil(FormScrollGeometry(application: app, scroll: frame, keyboard: nil))
            XCTAssertNil(FormScrollGeometry(application: frame, scroll: scroll, keyboard: nil))
            XCTAssertNil(FormScrollGeometry(application: app, scroll: scroll, keyboard: frame))
            XCTAssertFalse(geometry.contains(frame))
        }
        XCTAssertNil(FormScrollGeometry(application: app, scroll: scroll.offsetBy(dx: 400, dy: 0), keyboard: nil))
        XCTAssertNil(FormScrollGeometry(application: app, scroll: scroll, keyboard: CGRect(x: 0, y: 380, width: 375, height: 287)))

        let keyboard = CGRect(x: 0, y: 550, width: 375, height: 117)
        let covered = try XCTUnwrap(FormScrollGeometry(application: app, scroll: scroll, keyboard: keyboard))
        XCTAssertEqual(covered.viewport, CGRect(x: 0, y: 400, width: 375, height: 150))
        XCTAssertFalse(covered.contains(CGRect(x: 0, y: 540, width: 375, height: 44)))
        for top in [false, true] {
            for target in [nil, CGRect.null, CGRect(x: 0, y: top ? 350 : 650, width: 375, height: 44)] {
                let drag = try XCTUnwrap(covered.gesture(target: target, towardTop: top, horizontalPosition: 0.5))
                for point in [drag.start, drag.end] {
                    XCTAssertTrue(point.dx.isFinite && point.dy.isFinite)
                    XCTAssertTrue(covered.viewport.contains(CGPoint(x: point.dx, y: point.dy)))
                }
                XCTAssertEqual(drag.start.dx, 187.5)
                XCTAssertEqual(drag.start.dy, top ? 437.5 : 512.5)
                XCTAssertEqual(drag.end.dy > drag.start.dy, top)
            }
        }
        for position: CGFloat in [.nan, .infinity, -0.1, 1.1] {
            XCTAssertNil(covered.gesture(target: nil, towardTop: false, horizontalPosition: position))
        }
        // Application-relative offsets must stay coherent when the visible window has a nonzero origin.
        let offset = try XCTUnwrap(FormScrollGeometry(application: app.offsetBy(dx: 10, dy: 20), scroll: scroll.offsetBy(dx: 10, dy: 20), keyboard: keyboard.offsetBy(dx: 10, dy: 20)))
        let translated = try XCTUnwrap(offset.gesture(target: nil, towardTop: false, horizontalPosition: 0.5))
        XCTAssertEqual(translated.start.dx, 187.5)
        XCTAssertEqual(translated.start.dy, 512.5)
        try verifyPagedListTraversal()
        try verifyContainedOccludedTargetDirection()
    }

    private static func verifyContainedOccludedTargetDirection() throws {
        let app = CGRect(x: 0, y: 0, width: 402, height: 874)
        let geometry = try XCTUnwrap(FormScrollGeometry(application: app, scroll: app, keyboard: nil))
        // The transcript error was geometrically contained at y=11.33 but not
        // hittable. Keep revealing toward the top instead of oscillating across y=0.
        let target = CGRect(x: 24, y: 11.333333333333258, width: 354, height: 17)
        XCTAssertTrue(geometry.contains(target))
        let upward = try XCTUnwrap(geometry.gesture(target: target, towardTop: true, horizontalPosition: 0.5))
        XCTAssertGreaterThan(upward.end.dy, upward.start.dy)
        let downward = try XCTUnwrap(geometry.gesture(target: target, towardTop: false, horizontalPosition: 0.5))
        XCTAssertLessThan(downward.end.dy, downward.start.dy)
        // Actual clipping still takes precedence over the caller's search direction.
        let below = CGRect(x: 24, y: 880, width: 354, height: 17)
        let clipped = try XCTUnwrap(geometry.gesture(target: below, towardTop: true, horizontalPosition: 0.5))
        XCTAssertLessThan(clipped.end.dy, clipped.start.dy)
    }

    private static func verifyPagedListTraversal() throws {
        let app = CGRect(x: 0, y: 0, width: 402, height: 874)
        let scroll = CGRect(x: 24, y: 86, width: 354, height: 764)
        let geometry = try XCTUnwrap(FormScrollGeometry(application: app, scroll: scroll, keyboard: nil))
        for towardTop in [false, true] {
            let standard = try XCTUnwrap(geometry.gesture(target: nil, towardTop: towardTop, horizontalPosition: 0.5))
            let paged = try XCTUnwrap(geometry.gesture(target: nil, towardTop: towardTop, horizontalPosition: 0.5, maximumScrollFraction: 0.7))
            XCTAssertEqual(abs(standard.end.dy - standard.start.dy), scroll.height * 0.45, accuracy: 0.0001)
            XCTAssertEqual(abs(paged.end.dy - paged.start.dy), scroll.height * 0.7, accuracy: 0.0001)
            XCTAssertEqual(paged.end.dy > paged.start.dy, towardTop)
            for point in [paged.start, paged.end] {
                XCTAssertTrue(scroll.contains(CGPoint(x: point.dx, y: point.dy)))
            }
        }
        // The hosted row ended two points below the viewport. Longer travel must never turn clipping into success.
        let clipped = CGRect(x: 44, y: 761.33349609375, width: 314, height: 90.66650390625)
        XCTAssertFalse(geometry.contains(clipped))
        let correction = try XCTUnwrap(geometry.gesture(target: clipped, towardTop: false, horizontalPosition: 0.5, maximumScrollFraction: 0.7))
        XCTAssertEqual(correction.start.dy - correction.end.dy, 30, accuracy: 0.0001)
        XCTAssertTrue(geometry.contains(clipped.offsetBy(dx: 0, dy: -30)))
        for fraction: CGFloat in [.nan, .infinity, 0, -0.1, 0.71] {
            XCTAssertNil(geometry.gesture(target: nil, towardTop: false, horizontalPosition: 0.5, maximumScrollFraction: fraction))
        }
    }
}
