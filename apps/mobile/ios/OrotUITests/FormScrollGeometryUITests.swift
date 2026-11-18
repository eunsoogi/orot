import XCTest

/// Runs shared geometry checks independently of the export journey.
final class FormScrollGeometryUITests: XCTestCase {
    @MainActor
    func testFormGestureBoundaries() throws {
        try FormScrollGeometryRegression.verify()
        try verifyActionDockOcclusion()
        XCTAssertEqual(FormScrollGeometry.uniqueOwnerIndex([1, 0]), 0)
        XCTAssertEqual(FormScrollGeometry.uniqueOwnerIndex([0, 1]), 1)
        XCTAssertNil(FormScrollGeometry.uniqueOwnerIndex([0, 0]))
        XCTAssertNil(FormScrollGeometry.uniqueOwnerIndex([1, 1]))
        XCTAssertNil(FormScrollGeometry.uniqueOwnerIndex([2, 0]))
        XCTAssertEqual(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [1, 0], targetCounts: [1, 0]), 0)
        XCTAssertNil(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [1, 0], targetCounts: [0, 1]))
        XCTAssertNil(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [1, 1], targetCounts: [1, 0]))
        XCTAssertNil(FormScrollGeometry.matchingOwnerIndex(scrollCounts: [0, 0], targetCounts: nil))
        let window = CGRect(x: 0, y: 0, width: 951, height: 669)
        let appEnvelope = CGRect(x: 0, y: 0, width: 669, height: 951)
        let scroll = CGRect(x: 0, y: 0, width: 867, height: 386)
        let keyboard = CGRect(x: 75, y: 449, width: 801, height: 219)
        let geometry = try XCTUnwrap(FormScrollGeometry(application: window, scroll: scroll, keyboard: keyboard))
        XCTAssertNotEqual(window, appEnvelope)
        XCTAssertTrue(geometry.contains(CGRect(x: 170.67, y: 330, width: 526, height: 48)))
        XCTAssertFalse(geometry.contains(CGRect(x: 170.67, y: 362, width: 526, height: 48)))
        XCTAssertFalse(geometry.contains(CGRect(x: 350, y: 330, width: 526, height: 48)))
        let tallerScroll = CGRect(x: 0, y: 0, width: 867, height: 635)
        let keyboardClipped = try XCTUnwrap(FormScrollGeometry(application: window, scroll: tallerScroll, keyboard: keyboard))
        XCTAssertFalse(keyboardClipped.contains(CGRect(x: 170.67, y: 430, width: 526, height: 48)))
        let origin = CGPoint(x: 11, y: 23)
        let shifted = try XCTUnwrap(FormScrollGeometry(application: window.offsetBy(dx: origin.x, dy: origin.y),
                                                       scroll: scroll.offsetBy(dx: origin.x, dy: origin.y),
                                                       keyboard: keyboard.offsetBy(dx: origin.x, dy: origin.y)))
        let drag = try XCTUnwrap(shifted.gesture(target: CGRect(x: 170.67, y: 362, width: 526, height: 48).offsetBy(dx: origin.x, dy: origin.y), towardTop: false, horizontalPosition: 0.5))
        for point in [drag.start, drag.end] {
            XCTAssertTrue(shifted.viewport.contains(CGPoint(x: point.dx + origin.x, y: point.dy + origin.y)))
        }
    }

    /// Representative synthetic frames reproduce the hosted editor/dock overlap; native hit testing remains separate.
    private func verifyActionDockOcclusion() throws {
        let app = CGRect(x: 0, y: 0, width: 402, height: 874)
        let scroll = CGRect(x: 0, y: 110, width: 402, height: 764)
        let editor = CGRect(x: 55, y: 776, width: 292, height: 70)
        let save = CGRect(x: 101, y: 792, width: 160, height: 48)
        let before = try XCTUnwrap(FormScrollGeometry(application: app, scroll: scroll, keyboard: nil))
        XCTAssertTrue(before.contains(editor))
        XCTAssertTrue(save.contains(CGPoint(x: editor.midX, y: editor.midY)))
        for origin in [CGPoint.zero, CGPoint(x: 11, y: 23)] {
            let movedEditor = editor.offsetBy(dx: origin.x, dy: origin.y)
            let safe = FormScrollGeometry.unobstructedScrollFrame(
                scroll.offsetBy(dx: origin.x, dy: origin.y), target: movedEditor,
                controls: [save.offsetBy(dx: origin.x, dy: origin.y)],
            )
            XCTAssertEqual(safe.maxY, 792 + origin.y)
            let geometry = try XCTUnwrap(FormScrollGeometry(application: app.offsetBy(dx: origin.x, dy: origin.y), scroll: safe, keyboard: nil))
            XCTAssertFalse(geometry.contains(movedEditor))
            let drag = try XCTUnwrap(geometry.gesture(target: movedEditor, towardTop: false, horizontalPosition: 0.5))
            XCTAssertLessThan(drag.end.dy, drag.start.dy)
            for point in [drag.start, drag.end] {
                XCTAssertTrue(geometry.viewport.contains(CGPoint(x: point.dx + origin.x, y: point.dy + origin.y)))
            }
            XCTAssertTrue(geometry.contains(movedEditor.offsetBy(dx: 0, dy: -70)))
        }
        // A button beside the target does not turn its transparent horizontal gap into an obstacle.
        let beside = CGRect(x: 350, y: 792, width: 44, height: 48)
        XCTAssertEqual(FormScrollGeometry.unobstructedScrollFrame(scroll, target: editor, controls: [beside]), scroll)
        XCTAssertEqual(FormScrollGeometry.unobstructedScrollFrame(scroll, target: editor, controls: []), scroll)
        let safe = FormScrollGeometry.unobstructedScrollFrame(scroll, target: editor, controls: [save])
        let keyboard = CGRect(x: 0, y: 590, width: 402, height: 284)
        let focused = try XCTUnwrap(FormScrollGeometry(application: app, scroll: safe, keyboard: keyboard))
        XCTAssertEqual(focused.viewport.maxY, 590)
        XCTAssertFalse(focused.contains(editor))
    }
}
