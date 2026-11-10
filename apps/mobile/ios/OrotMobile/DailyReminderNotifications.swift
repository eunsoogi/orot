import Foundation
import UserNotifications

/// A preference contains only an explicit opt-in and a wall-clock time, never health data.
struct DailyReminderPreference {
    let enabled: Bool
    let hour: Int
    let minute: Int

    init?(_ value: [String: Any]) {
        guard let enabled = value["enabled"] as? Bool,
              let hour = value["hour"] as? Int, (0 ... 23).contains(hour),
              let minute = value["minute"] as? Int, (0 ... 59).contains(minute)
        else { return nil }
        self.enabled = enabled
        self.hour = hour
        self.minute = minute
    }

    var dictionary: [String: Any] {
        ["enabled": enabled, "hour": hour, "minute": minute]
    }

    func request() -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = "Orot"
        // Native reconciliation can run before the React Native catalog is available.
        content.body = NSLocalizedString(
            "dailyReportReminder.body",
            tableName: "ReminderCopy",
            comment: "Daily report reminder body",
        )
        content.userInfo = ["kind": "daily_report"]
        // No fixed timezone: the selected civil time follows the device when traveling.
        var components = DateComponents()
        components.hour = hour
        components.minute = minute
        return UNNotificationRequest(
            identifier: DailyReminderNotifications.requestIdentifier,
            content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true),
        )
    }
}

protocol DailyReminderCenter {
    func authorizationStatus() async -> String
    func requestAuthorization() async throws -> String
    func add(_ request: UNNotificationRequest) async throws
    func cancel(_ identifier: String)
}

private struct SystemDailyReminderCenter: DailyReminderCenter {
    let center: UNUserNotificationCenter
    func authorizationStatus() async -> String {
        await AppointmentReminderNotifications.shared.authorizationStatus()
    }

    func requestAuthorization() async throws -> String {
        try await AppointmentReminderNotifications.shared.requestAuthorization()
    }

    func add(_ request: UNNotificationRequest) async throws {
        try await center.add(request)
    }

    func cancel(_ identifier: String) {
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}

/// Serializes asynchronous updates so an older add cannot undo a later disable.
actor DailyReminderNotifications {
    static let shared = DailyReminderNotifications()
    static let requestIdentifier = "com.orot.daily-report"
    private let defaults: UserDefaults
    private let center: any DailyReminderCenter
    private let key = "com.orot.daily-report.preference"
    private var pending: Task<[String: Any], Never>?

    init(defaults: UserDefaults = .standard, center: (any DailyReminderCenter)? = nil) {
        self.defaults = defaults
        self.center = center ?? SystemDailyReminderCenter(center: .current())
    }

    func read() -> [String: Any]? {
        guard let value = defaults.dictionary(forKey: key), let preference = DailyReminderPreference(value) else { return nil }
        return preference.dictionary
    }

    func save(_ value: [String: Any]) async -> [String: Any] {
        guard let preference = DailyReminderPreference(value) else { return ["status": "error", "requestIdentifiers": []] }
        defaults.set(preference.dictionary, forKey: key)
        return await enqueue(requestPermission: preference.enabled)
    }

    func reconcile() async -> [String: Any] {
        await enqueue(requestPermission: false)
    }

    private func enqueue(requestPermission: Bool) async -> [String: Any] {
        let previous = pending
        let operation = Task {
            _ = await previous?.value
            return await self.apply(requestPermission: requestPermission)
        }
        pending = operation
        return await operation.value
    }

    private func apply(requestPermission: Bool) async -> [String: Any] {
        guard let value = defaults.dictionary(forKey: key), let preference = DailyReminderPreference(value), preference.enabled else {
            cancel()
            return ["status": "disabled", "requestIdentifiers": []]
        }
        do {
            if requestPermission, await center.authorizationStatus() == "notDetermined" {
                _ = try await center.requestAuthorization()
            }
            let authorization = await center.authorizationStatus()
            guard authorization == "authorized" else {
                cancel()
                return ["status": authorization == "denied" ? "denied" : "error",
                        "authorization": authorization, "requestIdentifiers": []]
            }
            try await center.add(preference.request())
            return ["status": "scheduled", "authorization": authorization,
                    "requestIdentifiers": [Self.requestIdentifier]]
        } catch {
            // Do not leave an obsolete time installed after a failed replacement.
            cancel()
            return ["status": "error", "requestIdentifiers": []]
        }
    }

    private func cancel() {
        center.cancel(Self.requestIdentifier)
    }
}
