import Foundation
@testable import Orot
import XCTest

/// Synthetic URL deliveries exercise persistence without opening external content.
final class RootURLInboxTests: OrotFailFastTestCase {
    func testValidDeliveriesSurviveReopenAndAcknowledgeOneAtATime() throws {
        let suite = "root-url-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let inbox = RootURLInbox(defaults: defaults)
        try inbox.receive(XCTUnwrap(URL(string: "orot://open/v1/records")))
        try inbox.receive(XCTUnwrap(URL(string: "orot://open/v1/conversation")))
        let first = try XCTUnwrap(inbox.peek())
        XCTAssertEqual(first["destination"], "records")
        XCTAssertEqual(RootURLInbox(defaults: defaults).peek(), first)
        inbox.acknowledge("not-the-delivery")
        XCTAssertEqual(inbox.peek(), first)
        try inbox.acknowledge(XCTUnwrap(first["id"]))
        let second = try XCTUnwrap(inbox.peek())
        XCTAssertEqual(second["destination"], "conversation")
        XCTAssertNotEqual(first["id"], second["id"])
        try inbox.acknowledge(XCTUnwrap(second["id"]))
        XCTAssertNil(inbox.peek())
    }

    func testInvalidInputCannotOverwriteAValidDelivery() throws {
        let suite = "root-url-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let inbox = RootURLInbox(defaults: defaults)
        try inbox.receive(XCTUnwrap(URL(string: "orot://open/v1/settings")))
        let first = inbox.peek()
        for raw in ["orot://open/v1/records?record=secret", "orot://open/v1/settings/extra", "orot://user@open/v1/settings"] {
            try inbox.receive(XCTUnwrap(URL(string: raw)))
        }
        XCTAssertEqual(inbox.peek(), first)
    }

    func testMalformedStoredHeadDoesNotBlockLaterValidDelivery() throws {
        let suite = "root-url-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let id = UUID().uuidString
        defaults.set([["id": "invalid", "destination": "records"], ["id": id, "destination": "schedule"]], forKey: "com.orot.mobile.root-url-inbox.v1")
        XCTAssertEqual(RootURLInbox(defaults: defaults).peek(), ["id": id, "destination": "schedule"])
    }
}
