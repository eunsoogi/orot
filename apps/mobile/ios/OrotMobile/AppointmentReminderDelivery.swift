import Foundation
import UserNotifications

/// Retained by the app notification delegate, including taps received before React is ready.
final class AppointmentReminderDelivery: NSObject, UNUserNotificationCenterDelegate {
    static let shared = AppointmentReminderDelivery()
    static let changed = Notification.Name("OrotAppointmentReminderOpened")
    private let lock = NSLock()
    private var pending: [String: String]?

    func hasPendingTarget() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return pending != nil
    }

    func consumeTarget() -> [String: String]? {
        lock.lock()
        defer { lock.unlock() }
        let target = pending
        pending = nil
        return target
    }

    func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void,
    ) {
        defer { completionHandler() }
        receive(response.notification.request, actionIdentifier: response.actionIdentifier)
    }

    /// Captures default-action taps only; dismissal cannot become navigation intent.
    func receive(_ request: UNNotificationRequest, actionIdentifier: String) {
        guard request.identifier == AppointmentReminderNotifications.requestIdentifier,
              actionIdentifier == UNNotificationDefaultActionIdentifier,
              let id = request.content.userInfo["appointmentId"] as? String,
              let key = request.content.userInfo["timeKey"] as? String
        else { return }
        lock.lock()
        pending = ["appointmentId": id, "timeKey": key]
        lock.unlock()
        // The event is only a wake signal. Consume the inbox once and validate the
        // current encrypted appointment before navigating; never infer consent to AI.
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void,
    ) {
        completionHandler(
            notification.request.identifier == AppointmentReminderNotifications.requestIdentifier
                ? [.banner, .list] : [],
        )
    }
}
