import Foundation
@testable import Orot
import UserNotifications
import XCTest

/// Synthetic bridge inputs verify content privacy without requesting OS notification permission.
final class AppointmentReminderNotificationTests: OrotFailFastTestCase {
    private func input() -> [String: Any] {
        let start = 2_064_380_400_000.0
        return [
            "appointmentId": "synthetic-visit",
            "appointmentStartAt": start,
            "fireAt": start - 3_600_000,
            "leadMinutes": 60,
            "floating": false,
            "timeKey": "instant:\(Int64(start))",
        ]
    }

    func testNotificationContentCannotCopyClinicalBridgeFields() throws {
        var value = input()
        value["clinicLabel"] = "Synthetic sensitive clinic"
        value["note"] = "Synthetic sensitive note"
        value["title"] = "Synthetic private title"
        value["body"] = "Synthetic private body"
        let request = try AppointmentReminderNotificationPlan(value as NSDictionary).request()
        XCTAssertEqual(request.content.title, "Orot")
        XCTAssertEqual(request.content.body, "준비할 내용을 확인해 보세요.")
        XCTAssertEqual(Set(request.content.userInfo.keys.compactMap { $0 as? String }), ["appointmentId", "timeKey"])
        XCTAssertEqual(request.content.userInfo["appointmentId"] as? String, "synthetic-visit")
        XCTAssertNil(request.content.sound)
        XCTAssertNil(request.content.badge)
        XCTAssertTrue(request.content.attachments.isEmpty)
    }

    func testZonedRequestUsesANonRepeatingUTCTrigger() throws {
        let request = try AppointmentReminderNotificationPlan(input() as NSDictionary).request()
        let trigger = try XCTUnwrap(request.trigger as? UNCalendarNotificationTrigger)
        XCTAssertFalse(trigger.repeats)
        XCTAssertEqual(trigger.dateComponents.timeZone?.secondsFromGMT(), 0)
    }

    func testFractionalTimestampsNeverRoundDeliveryEarlierThanTheSelectedOffset() throws {
        var value = input()
        let start = 2_064_380_400_250.0
        value["appointmentStartAt"] = start
        value["fireAt"] = start - 3_600_000
        value["timeKey"] = "instant:\(Int64(start))"
        let plan = try AppointmentReminderNotificationPlan(value as NSDictionary)
        let trigger = try XCTUnwrap(plan.request().trigger as? UNCalendarNotificationTrigger)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let resolved = try XCTUnwrap(calendar.date(from: trigger.dateComponents))
        XCTAssertEqual(resolved.timeIntervalSince1970, ceil(plan.fireAt.timeIntervalSince1970))
        XCTAssertGreaterThanOrEqual(resolved, plan.fireAt)
    }

    func testFloatingRequestRetainsCivilTimeIdentityWithoutPinningDeviceZone() throws {
        var value = input()
        value["floating"] = true
        value["timeKey"] = "floating:2035-06-02T09:30:00.000"
        let request = try AppointmentReminderNotificationPlan(value as NSDictionary).request()
        let trigger = try XCTUnwrap(request.trigger as? UNCalendarNotificationTrigger)
        XCTAssertNil(trigger.dateComponents.timeZone)
        XCTAssertEqual(request.content.userInfo["timeKey"] as? String, value["timeKey"] as? String)
    }

    func testColdStartInboxRetainsTheTargetUntilOneConsumerDrainsIt() throws {
        let inbox = AppointmentReminderDelivery()
        let request = try AppointmentReminderNotificationPlan(input() as NSDictionary).request()
        inbox.receive(request, actionIdentifier: UNNotificationDefaultActionIdentifier)
        XCTAssertTrue(inbox.hasPendingTarget())
        XCTAssertEqual(inbox.consumeTarget()?["appointmentId"], "synthetic-visit")
        XCTAssertFalse(inbox.hasPendingTarget())
        XCTAssertNil(inbox.consumeTarget())
    }

    func testDismissalAndOtherFeatureNotificationsCannotOpenVisitPreparation() throws {
        let inbox = AppointmentReminderDelivery()
        let request = try AppointmentReminderNotificationPlan(input() as NSDictionary).request()
        inbox.receive(request, actionIdentifier: UNNotificationDismissActionIdentifier)
        XCTAssertFalse(inbox.hasPendingTarget())
        let unrelated = UNNotificationRequest(
            identifier: "synthetic-other-feature", content: request.content, trigger: nil,
        )
        inbox.receive(unrelated, actionIdentifier: UNNotificationDefaultActionIdentifier)
        XCTAssertFalse(inbox.hasPendingTarget())
    }

    func testMalformedTimesAndUnsupportedDurationsCannotReachTheOS() {
        for (key, invalid) in [
            ("fireAt", Double.nan as Any),
            ("appointmentStartAt", Double.infinity as Any),
            ("leadMinutes", -60 as Any),
            ("timeKey", "Synthetic clinical text" as Any),
        ] {
            var value = input()
            value[key] = invalid
            XCTAssertThrowsError(try AppointmentReminderNotificationPlan(value as NSDictionary))
        }
    }
}
