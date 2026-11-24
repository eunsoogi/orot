import EventKit
@testable import Orot
import XCTest

/// Synthetic, unsaved EventKit objects only; never query or change a user's store.
final class CalendarRangeSnapshotTests: XCTestCase {
    func testPermissionGateDoesNotQueryAndReportsUnavailableCoverage() throws {
        XCTAssertEqual(EventKitCalendarSnapshot.calendarStatus(.canceled), "canceled")
        XCTAssertEqual(EventKitCalendarSnapshot.calendarStatus(.tentative), "tentative")
        XCTAssertEqual(EventKitCalendarSnapshot.calendarStatus(.confirmed), "confirmed")
        XCTAssertEqual(EventKitCalendarSnapshot.calendarStatus(.none), "none")
        let start = Date(timeIntervalSince1970: 0), end = Date(timeIntervalSince1970: 3600)
        for access in ["denied", "restricted", "writeOnly", "notDetermined"] {
            let response = EventKitCalendarSnapshot.rangeSnapshot(start: start, end: end, access: access) {
                XCTFail("A non-readable permission must never query EventKit")
                return []
            }
            XCTAssertEqual(response["access"] as? String, access)
            let query = try XCTUnwrap(response["query"] as? [String: Any])
            XCTAssertEqual(query["complete"] as? Bool, false)
        }
    }

    func testClassificationRevisionChangesForRecurrenceStatusAndFloatingSemantics() throws {
        func revision(
            _ snapshot: [String: Any],
            status: String = "confirmed",
            floating: Bool = false,
        ) throws -> String {
            try XCTUnwrap(EventKitCalendarSnapshot.classificationRevision(
                startAt: "2030-03-12T10:00:00.000Z",
                endAt: "2030-03-12T11:00:00.000Z",
                isFloating: floating,
                status: status,
                snapshot: snapshot,
            ))
        }
        let original: [String: Any] = [
            "title": "Synthetic calendar event",
            "isDetached": false,
            "recurrenceRules": [["frequency": "weekly", "interval": 1]],
        ]
        let base = try revision(original)
        let reordered: [String: Any] = [
            "recurrenceRules": [["interval": 1, "frequency": "weekly"]],
            "isDetached": false,
            "title": "Synthetic calendar event",
        ]
        XCTAssertEqual(try revision(reordered), base)
        var changedRule = original
        changedRule["recurrenceRules"] = [["frequency": "weekly", "interval": 2]]
        XCTAssertNotEqual(try revision(changedRule), base)
        var detached = original
        detached["isDetached"] = true
        XCTAssertNotEqual(try revision(detached), base)
        XCTAssertNotEqual(try revision(original, status: "canceled"), base)
        XCTAssertNotEqual(try revision(original, status: "tentative"), base)
        XCTAssertNotEqual(try revision(original, floating: true), base)
        XCTAssertFalse(base.contains("Synthetic"))
    }

    func testHalfOpenOverlapAndUnserializableEventsFailClosed() throws {
        let start = Date(timeIntervalSince1970: 100), end = Date(timeIntervalSince1970: 200)
        let store = EKEventStore()
        func event(_ from: Double, _ to: Double) -> EKEvent {
            let value = EKEvent(eventStore: store)
            value.title = "Synthetic unsaved event"
            value.startDate = Date(timeIntervalSince1970: from)
            value.endDate = Date(timeIntervalSince1970: to)
            return value
        }
        var reads = 0
        let response = EventKitCalendarSnapshot.rangeSnapshot(start: start, end: end, access: "fullAccess") {
            reads += 1
            // Two intersecting events lack persistent identifiers; boundary outsiders are excluded.
            return [event(50, 150), event(100, 100), event(50, 100), event(200, 250)]
        }
        XCTAssertEqual(reads, 1)
        let query = try XCTUnwrap(response["query"] as? [String: Any])
        XCTAssertEqual(query["complete"] as? Bool, false)
        XCTAssertEqual(query["omittedEventCount"] as? Int, 2)
        XCTAssertTrue(query["resultLimit"] is NSNull)
        let empty = EventKitCalendarSnapshot.rangeSnapshot(start: start, end: end, access: "fullAccess") { [] }
        XCTAssertEqual((empty["query"] as? [String: Any])?["complete"] as? Bool, true)
    }
}
