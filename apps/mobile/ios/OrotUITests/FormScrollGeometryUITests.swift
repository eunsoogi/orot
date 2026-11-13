import XCTest

/// Runs shared geometry checks independently of the export journey.
final class FormScrollGeometryUITests: XCTestCase {
    @MainActor
    func testFormGestureBoundaries() throws {
        try FormScrollGeometryRegression.verify()
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
}
