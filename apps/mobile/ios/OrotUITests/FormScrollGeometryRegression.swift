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
    }
}
