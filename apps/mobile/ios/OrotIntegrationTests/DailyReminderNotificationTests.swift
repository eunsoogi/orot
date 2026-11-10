import Foundation
@testable import Orot
import UserNotifications
import XCTest

private final class DailyReminderCenterFixture: DailyReminderCenter {
    var authorization = "authorized"
    var fail = false
    var prompts = 0
    var promptResult = "authorized"
    var requests: [String: UNNotificationRequest] = [:]
    var cancelled: [String] = []
    func authorizationStatus() async -> String {
        authorization
    }

    func requestAuthorization() async throws -> String {
        prompts += 1
        authorization = promptResult
        return authorization
    }

    func add(_ request: UNNotificationRequest) async throws {
        if fail {
            throw NSError(domain: "fixture", code: 1)
        }
        requests[request.identifier] = request
    }

    func cancel(_ identifier: String) {
        cancelled.append(identifier); requests.removeValue(forKey: identifier)
    }
}

final class DailyReminderNotificationTests: XCTestCase {
    func testOptInRestartRevocationAndOwnedCancellation() async throws {
        let suite = "daily-reminder-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let center = DailyReminderCenterFixture()
        let scheduler = DailyReminderNotifications(defaults: defaults, center: center)
        let initial = await scheduler.reconcile()
        XCTAssertEqual(initial["status"] as? String, "disabled")
        let preference: [String: Any] = ["enabled": true, "hour": 9, "minute": 30]
        let first = await scheduler.save(preference)
        XCTAssertEqual(first["status"] as? String, "scheduled")
        _ = await scheduler.save(preference)
        XCTAssertEqual(center.requests.count, 1)
        let request = try XCTUnwrap(center.requests[DailyReminderNotifications.requestIdentifier])
        XCTAssertEqual(request.content.userInfo as? [String: String], ["kind": "daily_report"])
        let trigger = try XCTUnwrap(request.trigger as? UNCalendarNotificationTrigger)
        XCTAssertTrue(trigger.repeats)
        XCTAssertNil(trigger.dateComponents.timeZone)
        XCTAssertEqual(trigger.dateComponents.hour, 9)
        XCTAssertEqual(trigger.dateComponents.minute, 30)
        // Calendar calculations exercise the floating components in two zones without
        // changing the device clock. They do not predict notification delivery.
        let iso = ISO8601DateFormatter()
        let start = try XCTUnwrap(iso.date(from: "2026-01-15T00:00:00Z"))
        var newYork = Calendar(identifier: .gregorian)
        newYork.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Seoul"))
        let nyNext = try XCTUnwrap(newYork.nextDate(after: start, matching: trigger.dateComponents, matchingPolicy: .strict))
        let seoulNext = try XCTUnwrap(seoul.nextDate(after: start, matching: trigger.dateComponents, matchingPolicy: .strict))
        XCTAssertEqual(nyNext, iso.date(from: "2026-01-15T14:30:00Z"))
        XCTAssertEqual(seoulNext, iso.date(from: "2026-01-15T00:30:00Z"))

        let gapPreference = try XCTUnwrap(DailyReminderPreference(["enabled": true, "hour": 2, "minute": 30]))
        let gap = try XCTUnwrap(gapPreference.request().trigger as? UNCalendarNotificationTrigger)
        let gapStart = try XCTUnwrap(iso.date(from: "2026-03-08T05:00:00Z"))
        let gapNext = try XCTUnwrap(newYork.nextDate(after: gapStart, matching: gap.dateComponents, matchingPolicy: .strict))
        XCTAssertEqual(gapNext, iso.date(from: "2026-03-09T06:30:00Z"))
        let foldPreference = try XCTUnwrap(DailyReminderPreference(["enabled": true, "hour": 1, "minute": 30]))
        let fold = try XCTUnwrap(foldPreference.request().trigger as? UNCalendarNotificationTrigger)
        let foldStart = try XCTUnwrap(iso.date(from: "2026-11-01T04:00:00Z"))
        let firstFold = try XCTUnwrap(newYork.nextDate(after: foldStart, matching: fold.dateComponents, matchingPolicy: .strict, repeatedTimePolicy: .first))
        let lastFold = try XCTUnwrap(newYork.nextDate(after: foldStart, matching: fold.dateComponents, matchingPolicy: .strict, repeatedTimePolicy: .last))
        XCTAssertEqual(firstFold, iso.date(from: "2026-11-01T05:30:00Z"))
        XCTAssertEqual(lastFold, iso.date(from: "2026-11-01T06:30:00Z"))
        let restarted = DailyReminderNotifications(defaults: defaults, center: center)
        let saved = await restarted.read()
        XCTAssertEqual(saved?["hour"] as? Int, 9)
        center.authorization = "denied"
        let revoked = await restarted.reconcile()
        XCTAssertEqual(revoked["status"] as? String, "denied")
        XCTAssertEqual(center.cancelled.last, DailyReminderNotifications.requestIdentifier)
        XCTAssertFalse(center.cancelled.contains(AppointmentReminderNotifications.requestIdentifier))
        XCTAssertEqual(center.prompts, 0)
    }

    func testFailureAndDisableRemoveOnlyDailyRequest() async throws {
        let suite = "daily-reminder-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let center = DailyReminderCenterFixture()
        let scheduler = DailyReminderNotifications(defaults: defaults, center: center)
        _ = await scheduler.save(["enabled": true, "hour": 1, "minute": 30])
        center.fail = true
        let failed = await scheduler.save(["enabled": true, "hour": 2, "minute": 30])
        XCTAssertEqual(failed["status"] as? String, "error")
        XCTAssertTrue(center.requests.isEmpty)
        let disabled = await scheduler.save(["enabled": false, "hour": 2, "minute": 30])
        XCTAssertEqual(disabled["status"] as? String, "disabled")
        XCTAssertFalse(center.cancelled.contains(AppointmentReminderNotifications.requestIdentifier))
    }

    func testDeniedPermissionAndInvalidTimeDoNotSchedule() async throws {
        let suite = "daily-reminder-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let center = DailyReminderCenterFixture()
        center.authorization = "denied"
        let scheduler = DailyReminderNotifications(defaults: defaults, center: center)
        let denied = await scheduler.save(["enabled": true, "hour": 8, "minute": 0])
        XCTAssertEqual(denied["status"] as? String, "denied")
        let invalid = await scheduler.save(["enabled": true, "hour": 24, "minute": 0])
        XCTAssertEqual(invalid["status"] as? String, "error")
        let saved = await scheduler.read()
        XCTAssertEqual(saved?["hour"] as? Int, 8)
        XCTAssertTrue(center.requests.isEmpty)
        XCTAssertEqual(center.prompts, 0)
    }

    func testOnlyExplicitEnableRequestsUndeterminedPermission() async throws {
        let suite = "daily-reminder-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let center = DailyReminderCenterFixture()
        center.authorization = "notDetermined"
        let scheduler = DailyReminderNotifications(defaults: defaults, center: center)
        _ = await scheduler.reconcile()
        XCTAssertEqual(center.prompts, 0)
        let enabled = await scheduler.save(["enabled": true, "hour": 8, "minute": 15])
        XCTAssertEqual(enabled["status"] as? String, "scheduled")
        XCTAssertEqual(center.prompts, 1)
        _ = await scheduler.reconcile()
        XCTAssertEqual(center.prompts, 1)
    }
}
