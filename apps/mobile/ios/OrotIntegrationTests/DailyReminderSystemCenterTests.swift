import Foundation
@testable import Orot
import UserNotifications
import XCTest

/// This opt-in check observes the OS scheduler; delivery and taps require a separate UI journey.
final class DailyReminderSystemCenterTests: XCTestCase {
    func testDailyPreferenceRegistersPrivacySafeRequestWithSystemCenter() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["OROT_DAILY_REMINDER_SYSTEM_TEST"] == "YES",
                          "Requires a disposable, explicitly allocated app installation")
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        XCTAssertEqual(settings.authorizationStatus, .authorized, "Grant notification permission on the disposable installation first")
        guard settings.authorizationStatus == .authorized else { return }
        let identifier = DailyReminderNotifications.requestIdentifier
        let before = await center.pendingNotificationRequests()
        let deliveredBefore = await center.deliveredNotifications()
        XCTAssertFalse(before.contains { $0.identifier == identifier }, "A pre-existing daily reminder must not be replaced")
        XCTAssertFalse(deliveredBefore.contains { $0.request.identifier == identifier }, "A pre-existing delivery must not be removed")
        guard !before.contains(where: { $0.identifier == identifier }),
              !deliveredBefore.contains(where: { $0.request.identifier == identifier }) else { return }

        let suite = "daily-reminder-system-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer {
            center.removePendingNotificationRequests(withIdentifiers: [identifier])
            center.removeDeliveredNotifications(withIdentifiers: [identifier])
            defaults.removePersistentDomain(forName: suite)
        }
        // The real wall clock determines the next calendar request; no device clock is changed.
        let future = Date().addingTimeInterval(5 * 60)
        let time = Calendar.current.dateComponents([.hour, .minute], from: future)
        let scheduler = DailyReminderNotifications(defaults: defaults)
        let result = try await scheduler.save([
            "enabled": true, "hour": XCTUnwrap(time.hour), "minute": XCTUnwrap(time.minute),
        ])
        XCTAssertEqual(result["status"] as? String, "scheduled")
        let pending = await center.pendingNotificationRequests().filter { $0.identifier == identifier }
        XCTAssertEqual(pending.count, 1)
        let request = try XCTUnwrap(pending.first)
        XCTAssertEqual(request.content.title, "오롯")
        XCTAssertEqual(request.content.body, "오늘의 기록을 확인해 보세요.")
        XCTAssertEqual(request.content.userInfo as? [String: String], ["kind": "daily_report"])
        let trigger = try XCTUnwrap(request.trigger as? UNCalendarNotificationTrigger)
        XCTAssertTrue(trigger.repeats)
        XCTAssertEqual(trigger.dateComponents.hour, time.hour)
        XCTAssertEqual(trigger.dateComponents.minute, time.minute)
        XCTAssertNil(trigger.dateComponents.timeZone)
        XCTAssertNotNil(trigger.nextTriggerDate())
    }
}
