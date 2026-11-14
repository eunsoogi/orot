import Foundation
@testable import Orot
import UserNotifications
import XCTest

/// Synthetic taps test durable identity handling; this does not prove system delivery.
final class ReplyNotificationInboxTests: OrotFailFastTestCase {
    func testInterruptionPurposeSurvivesRestartWithoutBecomingAnAnswer() throws {
        let suite = "interruption-inbox-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let inbox = AppointmentReminderDelivery(defaults: defaults)
        let content = UNMutableNotificationContent()
        content.userInfo = ["requestId": "interruption:turn", "sessionId": "session", "messageId": "turn", "sessionVersion": 0, "purpose": "interruption"]
        let request = UNNotificationRequest(identifier: ReplyNotificationService.prefix + "interruption:turn", content: content, trigger: nil)
        inbox.receive(request, actionIdentifier: UNNotificationDefaultActionIdentifier)
        let restarted = AppointmentReminderDelivery(defaults: defaults)
        XCTAssertEqual(restarted.consumeReplyTarget()?["purpose"], "interruption")
        XCTAssertEqual(restarted.consumeReplyTarget()?["messageId"], "turn")
        restarted.acknowledgeReplyTarget("interruption:turn")
        XCTAssertNil(restarted.consumeReplyTarget())
    }

    func testReplyTapSurvivesRestartAndDoesNotReplaceOtherReminderTargets() async throws {
        let suite = "reply-inbox-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let inbox = AppointmentReminderDelivery(defaults: defaults)
        let appointment = UNMutableNotificationContent()
        appointment.userInfo = ["appointmentId": "appointment", "timeKey": "time"]
        inbox.receive(UNNotificationRequest(identifier: AppointmentReminderNotifications.requestIdentifier, content: appointment, trigger: nil), actionIdentifier: UNNotificationDefaultActionIdentifier)
        let content = UNMutableNotificationContent()
        content.userInfo = ["requestId": "request", "sessionId": "session", "messageId": "message", "sessionVersion": 2]
        let request = UNNotificationRequest(identifier: ReplyNotificationService.prefix + "request", content: content, trigger: nil)
        inbox.receive(request, actionIdentifier: UNNotificationDefaultActionIdentifier)
        let pending = try XCTUnwrap(defaults.array(forKey: "com.orot.reply.delivery-inbox"))
        let unsafeVersion = ["requestId": "unsafe", "sessionId": "session", "messageId": "message", "sessionVersion": "9007199254740992"]
        defaults.set(["malformed" as Any, unsafeVersion] + pending, forKey: "com.orot.reply.delivery-inbox")
        let restarted = AppointmentReminderDelivery(defaults: defaults)
        XCTAssertEqual(restarted.consumeReplyTarget(), ["requestId": "request", "sessionId": "session", "messageId": "message", "sessionVersion": "2"])
        XCTAssertEqual(inbox.consumeTarget(), ["appointmentId": "appointment", "timeKey": "time"])
        restarted.acknowledgeReplyTarget("request")
        restarted.receive(request, actionIdentifier: UNNotificationDefaultActionIdentifier)
        XCTAssertNil(restarted.consumeReplyTarget())
        let service = ReplyNotificationService(defaults: defaults)
        let lease = await service.lease(sessionId: "session")
        let ticket = try XCTUnwrap(lease["global"])
        let sessionTicket = try XCTUnwrap(lease["session"])
        await service.removeSession("session")
        let stale = await service.isCurrent(sessionId: "session", ticket: ticket, sessionTicket: sessionTicket)
        XCTAssertFalse(stale)
    }
}
