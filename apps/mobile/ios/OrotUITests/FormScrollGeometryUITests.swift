import XCTest

/// Runs shared geometry checks independently of the export journey.
final class FormScrollGeometryUITests: XCTestCase {
    @MainActor
    func testFormGestureBoundaries() throws {
        try FormScrollGeometryRegression.verify()
    }
}
