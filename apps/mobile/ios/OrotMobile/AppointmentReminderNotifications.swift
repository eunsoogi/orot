import Foundation
import UserNotifications

/// The bridge accepts schedule metadata only; clinical notification text is not configurable.
struct AppointmentReminderNotificationPlan {
    let appointmentId: String
    let timeKey: String
    let fireAt: Date
    let floating: Bool

    init(_ value: NSDictionary) throws {
        guard let id = value["appointmentId"] as? String, !id.isEmpty, id.count <= 512,
              let key = value["timeKey"] as? String,
              let start = value["appointmentStartAt"] as? Double, start.isFinite,
              let fire = value["fireAt"] as? Double, fire.isFinite,
              let lead = value["leadMinutes"] as? Int, [60, 1440].contains(lead),
              let floating = value["floating"] as? Bool,
              abs(start - fire - Double(lead) * 60000) < 1,
              fire > 0, start < 253_402_300_800_000
        else { throw AppointmentReminderError.invalidInput }
        if floating {
            guard key.range(
                of: #"^floating:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$"#,
                options: .regularExpression,
            ) != nil else { throw AppointmentReminderError.invalidInput }
        } else {
            guard key == "instant:\(Int64(start))" else {
                throw AppointmentReminderError.invalidInput
            }
        }
        appointmentId = id
        timeKey = key
        fireAt = Date(timeIntervalSince1970: fire / 1000)
        self.floating = floating
    }

    /// Both visible content and payload are built from an allowlist, not appointment dictionaries.
    func request() -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = "Orot"
        content.body = "준비할 내용을 확인해 보세요."
        content.userInfo = ["appointmentId": appointmentId, "timeKey": timeKey]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = floating ? .current : TimeZone(secondsFromGMT: 0)!
        // Calendar triggers have second precision. Round up so fractional visit
        // timestamps cannot make preparation reminders fire before their offset.
        let deliveryTime = Date(timeIntervalSince1970: ceil(fireAt.timeIntervalSince1970))
        var components = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: deliveryTime,
        )
        // Floating Calendar visits follow civil time if the device zone changes.
        // Zoned/manual instants use UTC components so travel cannot shift delivery.
        if !floating {
            components.timeZone = calendar.timeZone
        }
        return UNNotificationRequest(
            identifier: AppointmentReminderNotifications.requestIdentifier,
            content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false),
        )
    }
}

enum AppointmentReminderError: Error {
    case invalidInput
    case permissionDenied
    case expired
}

/// Keeps feature-owned request operations injectable so their ordering can be tested without OS permission state.
protocol AppointmentReminderNotificationCenter {
    func removePendingNotificationRequests(withIdentifiers identifiers: [String])
    func removeDeliveredNotifications(withIdentifiers identifiers: [String])
    func add(_ request: UNNotificationRequest) async throws
}

private struct SystemAppointmentReminderNotificationCenter: AppointmentReminderNotificationCenter {
    let center: UNUserNotificationCenter

    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }

    func removeDeliveredNotifications(withIdentifiers identifiers: [String]) {
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    func add(_ request: UNNotificationRequest) async throws {
        try await center.add(request)
    }
}

struct AppointmentReminderRequestScheduler {
    private let center: any AppointmentReminderNotificationCenter

    init(center: any AppointmentReminderNotificationCenter) {
        self.center = center
    }

    /// UserNotifications replaces pending requests with the same identifier; removing first opens an observable asynchronous gap.
    func replace(_ request: UNNotificationRequest) async throws {
        center.removeDeliveredNotifications(withIdentifiers: [AppointmentReminderNotifications.requestIdentifier])
        try await center.add(request)
    }

    /// Explicit cancellation clears both pending and already delivered alerts owned by this feature.
    func cancel() {
        let identifiers = [AppointmentReminderNotifications.requestIdentifier]
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
}

/// Owns one local request. No APNs registration, token, network, or EventKit write is involved.
actor AppointmentReminderNotifications {
    static let shared = AppointmentReminderNotifications()
    static let requestIdentifier = "com.orot.visit-preparation"
    private let center: UNUserNotificationCenter
    private let requestScheduler: AppointmentReminderRequestScheduler
    private let defaults = UserDefaults.standard
    private let selectionKey = "com.orot.visit-preparation.selection"
    private var replacement: Task<Void, Error>?
    private var revision = 0

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
        requestScheduler = AppointmentReminderRequestScheduler(
            center: SystemAppointmentReminderNotificationCenter(center: center),
        )
    }

    func readSelection() -> [String: Any]? {
        guard let selection = defaults.dictionary(forKey: selectionKey),
              let id = selection["appointmentId"] as? String, !id.isEmpty,
              let lead = selection["leadMinutes"] as? Int, [60, 1440].contains(lead)
        else { return nil }
        return ["appointmentId": id, "leadMinutes": lead]
    }

    func writeSelection(_ selection: [String: Any]?) throws {
        guard let selection else {
            defaults.removeObject(forKey: selectionKey)
            return
        }
        guard let id = selection["appointmentId"] as? String, !id.isEmpty, id.count <= 512,
              let lead = selection["leadMinutes"] as? Int, [60, 1440].contains(lead)
        else { throw AppointmentReminderError.invalidInput }
        // This local preference contains only an opaque ID and duration.
        // The appointment itself remains in encrypted storage, outside notification preferences.
        defaults.set(["appointmentId": id, "leadMinutes": lead], forKey: selectionKey)
    }

    func authorizationStatus() async -> String {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return "authorized"
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        @unknown default: return "denied"
        }
    }

    /// This method is reserved for the user's explicit enable-reminder action.
    func requestAuthorization() async throws -> String {
        if await authorizationStatus() == "notDetermined" {
            _ = try await center.requestAuthorization(options: [.alert])
        }
        return await authorizationStatus()
    }

    func replace(_ plan: AppointmentReminderNotificationPlan?) async throws {
        revision += 1
        let current = revision
        let previous = replacement
        // Actor reentrancy alone cannot serialize asynchronous notification adds.
        // Chain replacements so a delayed add cannot resurrect a cancelled request.
        let operation = Task {
            _ = try? await previous?.value
            try await apply(plan)
        }
        replacement = operation
        do {
            try await operation.value
            if revision == current {
                replacement = nil
            }
        } catch {
            if revision == current {
                replacement = nil
            }
            throw error
        }
    }

    private func apply(_ plan: AppointmentReminderNotificationPlan?) async throws {
        guard let plan else {
            requestScheduler.cancel()
            return
        }
        guard plan.fireAt > Date() else { throw AppointmentReminderError.expired }
        guard await authorizationStatus() == "authorized" else {
            throw AppointmentReminderError.permissionDenied
        }
        // Authorization lookup is asynchronous. Do not claim a request was installed
        // if its full calendar date has already passed while awaiting the OS reply.
        let request = plan.request()
        guard plan.fireAt > Date(),
              let trigger = request.trigger as? UNCalendarNotificationTrigger,
              let next = trigger.nextTriggerDate(), next > Date()
        else { throw AppointmentReminderError.expired }
        try await requestScheduler.replace(request)
    }
}
