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
        try verifyFocusedEditorReservation()
        try verifyClippedFocusedExtent()
    }

    private static func verifyClippedFocusedExtent() throws {
        let app = CGRect(x: 0, y: 0, width: 402, height: 874)
        let keyboard = CGRect(x: 0, y: 590, width: 402, height: 226)
        let focused = try XCTUnwrap(FormScrollGeometry(application: app, scroll: app, keyboard: keyboard))
        // Actual hosted frames: the AX slice ends at 546 while its keyboard frame starts at 590.
        let observations: [(CGFloat, CGFloat, CGFloat)] = [(449.8334706624346, 96.16652933756541, 195.6669921875), (511.5000101725261, 34.49998982747388, 93)]
        for (origin, height, minimum) in observations {
            let slice = CGRect(x: 51.833333015441895, y: origin, width: 298.33331298828125, height: height)
            let reference = CGSize(width: slice.width, height: minimum)
            XCTAssertTrue(focused.contains(slice))
            XCTAssertFalse(focused.contains(slice, referenceSize: reference))
            let reservation = try XCTUnwrap(focused.keyboardReservation(keyboard, for: slice, referenceSize: reference))
            XCTAssertEqual(reservation.minY, 546, accuracy: 0.0001)
            let duringDrag = try XCTUnwrap(FormScrollGeometry(application: app, scroll: app, keyboard: nil, reservedKeyboard: reservation))
            XCTAssertFalse(duringDrag.contains(slice, referenceSize: reference))
            let restored = CGRect(x: slice.minX, y: 546 - minimum - 8, width: slice.width, height: minimum)
            XCTAssertTrue(duringDrag.contains(restored, referenceSize: reference))
            XCTAssertTrue(focused.contains(restored, referenceSize: reference))
            XCTAssertEqual(focused.keyboardReservation(keyboard, for: restored, referenceSize: reference), keyboard)
            let hiddenKeyboard = keyboard.offsetBy(dx: 0, dy: 328)
            XCTAssertEqual(focused.keyboardReservation(hiddenKeyboard, for: slice, referenceSize: reference), hiddenKeyboard)
            for invalid: CGFloat in [.nan, .infinity, 0, -1] {
                XCTAssertFalse(focused.contains(slice, referenceSize: CGSize(width: slice.width, height: invalid)))
                XCTAssertNil(focused.keyboardReservation(keyboard, for: slice, referenceSize: CGSize(width: slice.width, height: invalid)))
                XCTAssertFalse(focused.contains(restored, referenceSize: CGSize(width: invalid, height: minimum)))
                XCTAssertNil(focused.keyboardReservation(keyboard, for: slice, referenceSize: CGSize(width: invalid, height: minimum)))
            }
            // Width changes can reflow text; a shorter frame then cannot establish keyboard clipping.
            let reflowed = CGSize(width: reference.width + 1, height: minimum)
            XCTAssertFalse(focused.contains(restored, referenceSize: reflowed))
            XCTAssertNil(focused.keyboardReservation(keyboard, for: slice, referenceSize: reflowed))
            let rounded = CGSize(width: reference.width + 0.00005, height: minimum + 0.00005)
            XCTAssertTrue(focused.contains(restored, referenceSize: rounded))
            XCTAssertNotNil(focused.keyboardReservation(keyboard, for: slice, referenceSize: rounded))
        }
        let topSlice = CGRect(x: 52, y: 0, width: 298, height: 96)
        XCTAssertEqual(focused.keyboardReservation(keyboard, for: topSlice, referenceSize: CGSize(width: 298, height: 196)), keyboard)
        let noKeyboard = try XCTUnwrap(FormScrollGeometry(application: app, scroll: app, keyboard: nil))
        XCTAssertTrue(noKeyboard.contains(CGRect(x: 52, y: 450, width: 298, height: 196), referenceSize: CGSize(width: 298, height: 196)))
        XCTAssertNil(focused.keyboardReservation(.zero, for: topSlice, referenceSize: CGSize(width: 298, height: 196)))
        XCTAssertNil(focused.keyboardReservation(keyboard, for: .infinite, referenceSize: CGSize(width: 298, height: 196)))
    }

    private static func verifyFocusedEditorReservation() throws {
        let app = CGRect(x: 0, y: 0, width: 402, height: 874)
        let keyboard = CGRect(x: 0, y: 590, width: 402, height: 226)
        // The hosted large editor is partially covered after focus despite its pre-focus containment.
        let editor = CGRect(x: 52, y: 450, width: 298, height: 196)
        let before = try XCTUnwrap(FormScrollGeometry(application: app, scroll: app, keyboard: nil))
        XCTAssertTrue(before.contains(editor))
        for current in [nil, keyboard, keyboard.offsetBy(dx: 0, dy: 328)] {
            let reserved = try XCTUnwrap(FormScrollGeometry(application: app, scroll: app, keyboard: current, reservedKeyboard: keyboard))
            XCTAssertEqual(reserved.viewport.maxY, 590)
            XCTAssertFalse(reserved.contains(editor))
            let position = try XCTUnwrap(reserved.horizontalPosition(outside: editor))
            let gesture = try XCTUnwrap(reserved.gesture(target: editor, towardTop: false, horizontalPosition: position))
            XCTAssertGreaterThan(gesture.start.dx, editor.maxX)
            XCTAssertLessThan(gesture.start.dx, reserved.viewport.maxX)
            XCTAssertFalse(editor.contains(CGPoint(x: gesture.start.dx, y: gesture.start.dy)))
        }
        XCTAssertNil(before.horizontalPosition(outside: app))
        XCTAssertNil(before.horizontalPosition(outside: .infinite))
        XCTAssertNil(FormScrollGeometry(application: app, scroll: app, keyboard: nil, reservedKeyboard: .zero))
        let taller = try XCTUnwrap(FormScrollGeometry(application: app, scroll: app, keyboard: keyboard.offsetBy(dx: 0, dy: -40), reservedKeyboard: keyboard))
        XCTAssertEqual(taller.viewport.maxY, 550)
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
