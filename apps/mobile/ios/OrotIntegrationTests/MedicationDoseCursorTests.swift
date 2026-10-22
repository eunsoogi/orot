import Foundation
#if canImport(Orot)
    @testable import Orot
#endif
import XCTest

#if canImport(Orot)
    typealias MedicationDoseCursorTestCase = OrotFailFastTestCase
#else
    typealias MedicationDoseCursorTestCase = XCTestCase
#endif

/// Uses synthetic opaque identifiers; never deletes personal Health data to test reconciliation.
final class MedicationDoseCursorTests: MedicationDoseCursorTestCase {
    func testCatalogShrinkageAndEmptyVisibilityRetainDeletionScope() throws {
        let initial = MedicationDoseCursor(anchor: "page", concepts: ["A", "B"])
        let restored = try MedicationDoseCursor.decode(initial.encoded(anchor: initial.anchor))
        let shrunk = try restored.merging(.success(["B"]), replay: false)
        XCTAssertEqual(shrunk.concepts, ["A", "B"], "A tombstones must still match the anchored query")
        XCTAssertEqual(shrunk.anchor, "page")
        let empty = try shrunk.merging(.success([]), replay: false)
        XCTAssertEqual(empty.concepts, ["A", "B"])
        XCTAssertEqual(empty.anchor, "page", "Empty visibility is not deletion or permission evidence")
        let fresh = try MedicationDoseCursor.decode(nil).merging(.success([]), replay: false)
        XCTAssertTrue(fresh.concepts.isEmpty, "An initial empty scope must stay restrictive")
        XCTAssertNil(fresh.anchor)
    }

    func testReplayExpansionAndErrorsPreserveCheckpointInvariants() throws {
        let previous = MedicationDoseCursor(anchor: "page", concepts: ["A", "B"])
        let replay = try previous.merging(.success(["B"]), replay: true)
        XCTAssertNil(replay.anchor)
        XCTAssertEqual(replay.concepts, ["A", "B"])
        let expanded = try previous.merging(.success(["C"]), replay: false)
        XCTAssertNil(expanded.anchor, "New concepts require their older dose history")
        XCTAssertEqual(expanded.concepts, ["A", "B", "C"])
        let failure = NSError(domain: "SyntheticMedicationCatalog", code: 1)
        XCTAssertThrowsError(try previous.merging(.failure(failure), replay: false))
        XCTAssertEqual(previous.anchor, "page")
        XCTAssertEqual(previous.concepts, ["A", "B"])
        XCTAssertThrowsError(try MedicationDoseCursor.decode(MedicationDoseCursor.prefix + "broken"))
        XCTAssertNil(try MedicationDoseCursor.decode("legacy-anchor").anchor)
    }
}
