import Foundation
import UserNotifications

/// Retained by the app notification delegate, including taps received before React is ready.
final class AppointmentReminderDelivery: NSObject, UNUserNotificationCenterDelegate {
    static let shared = AppointmentReminderDelivery()
    static let changed = Notification.Name("OrotAppointmentReminderOpened")
    private let lock = NSLock()
    private var pending: [String: String]?
    private let defaults: UserDefaults
    private let dailyKey = "com.orot.daily-report.delivery-inbox"
    private let handledDailyKey = "com.orot.daily-report.delivery-handled"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        super.init()
    }

    func consumeDailyTarget() -> [String: String]? {
        lock.lock()
        defer { lock.unlock() }
        return (defaults.array(forKey: dailyKey) as? [[String: String]])?.first
    }

    func acknowledgeDailyTarget(_ timestamp: String) {
        lock.lock()
        defer { lock.unlock() }
        var targets = defaults.array(forKey: dailyKey) as? [[String: String]] ?? []
        guard targets.first?["deliveryTimestamp"] == timestamp else { return }
        targets.removeFirst()
        defaults.set(targets, forKey: dailyKey)
        var handled = defaults.stringArray(forKey: handledDailyKey) ?? []
        handled.append(timestamp)
        defaults.set(Array(handled.suffix(32)), forKey: handledDailyKey)
    }

    func hasPendingTarget() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return pending != nil || !(defaults.array(forKey: dailyKey) ?? []).isEmpty
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
        receive(response.notification.request, actionIdentifier: response.actionIdentifier, deliveredAt: response.notification.date)
    }

    /// Captures default-action taps only; dismissal cannot become navigation intent.
    func receive(_ request: UNNotificationRequest, actionIdentifier: String, deliveredAt: Date? = nil) {
        if request.identifier == DailyReminderNotifications.requestIdentifier,
           actionIdentifier == UNNotificationDefaultActionIdentifier
        {
            // Delivery time is an observed instant, not evidence of the delivery timezone.
            let timestamp = deliveredAt.map { String($0.timeIntervalSince1970) } ?? ""
            lock.lock()
            var targets = defaults.array(forKey: dailyKey) as? [[String: String]] ?? []
            let target = ["kind": request.content.userInfo["kind"] as? String ?? "", "deliveryTimestamp": timestamp]
            let handled = defaults.stringArray(forKey: handledDailyKey) ?? []
            if !handled.contains(timestamp), !targets.contains(where: { $0["deliveryTimestamp"] == timestamp }) {
                targets.append(target)
                defaults.set(targets, forKey: dailyKey)
            }
            lock.unlock()
            NotificationCenter.default.post(name: Self.changed, object: nil)
            return
        }
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
            [AppointmentReminderNotifications.requestIdentifier, DailyReminderNotifications.requestIdentifier].contains(notification.request.identifier)
                ? [.banner, .list] : [],
        )
    }
}
