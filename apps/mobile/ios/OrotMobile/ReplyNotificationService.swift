import Foundation
import UIKit
import UserNotifications

/// Keeps local reply notification preferences and identifiers separate from reminder schedules.
actor ReplyNotificationService {
    static let shared = ReplyNotificationService()
    static let prefix = "com.orot.reply."
    private let center = UNUserNotificationCenter.current()
    private let defaults = UserDefaults.standard
    private let preferenceKey = "com.orot.reply.preference"
    private let identitiesKey = "com.orot.reply.identities"
    private var invalidation = 0
    private var sessionInvalidations: [String: Int] = [:]

    func read() -> [String: Bool] {
        let value = defaults.dictionary(forKey: preferenceKey)
        return ["enabled": value?["enabled"] as? Bool ?? false,
                "preview": value?["preview"] as? Bool ?? true]
    }

    /// Only an explicit settings change may present the system permission prompt.
    func save(enabled: Bool, preview: Bool) async -> String {
        let previous = read()
        defaults.set(["enabled": enabled, "preview": preview], forKey: preferenceKey)
        if previous["preview"] == true && !preview { removeAll() }
        if !enabled {
            removeAll()
            return "disabled"
        }
        var status = await center.notificationSettings().authorizationStatus
        if status == .notDetermined {
            do { _ = try await center.requestAuthorization(options: [.alert, .sound, .badge]) }
            catch { return "error" }
            status = await center.notificationSettings().authorizationStatus
        }
        return status == .authorized || status == .provisional ? "authorized" : "denied"
    }

    func authorized() async -> Bool {
        let status = await center.notificationSettings().authorizationStatus
        return status == .authorized || status == .provisional
    }

    /// This final native boundary does not force presentation over Focus or system preview settings.
    func submit(requestId: String, sessionId: String, messageId: String, version: Int, preview: String) async -> Bool {
        let ticket = invalidation
        let sessionTicket = sessionInvalidations[sessionId, default: 0]
        guard [requestId, sessionId, messageId].allSatisfy({ !$0.isEmpty && $0.count <= 200 }),
              version >= 0, !preview.isEmpty, read()["enabled"] == true, await authorized()
        else { return false }
        let available = await MainActor.run {
            UIApplication.shared.applicationState == .background && UIApplication.shared.isProtectedDataAvailable
        }
        guard available, read()["enabled"] == true, ticket == invalidation,
              sessionTicket == sessionInvalidations[sessionId, default: 0] else { return false }
        let identifier = Self.prefix + requestId
        let content = UNMutableNotificationContent()
        content.title = "오롯"
        content.body = read()["preview"] == true ? preview : "새 답변이 도착했어요."
        content.userInfo = ["requestId": requestId, "sessionId": sessionId, "messageId": messageId, "sessionVersion": version]
        var identities = defaults.dictionary(forKey: identitiesKey) as? [String: [String]] ?? [:]
        var ids = identities[sessionId] ?? []
        if !ids.contains(identifier) { ids.append(identifier) }
        identities[sessionId] = ids
        defaults.set(identities, forKey: identitiesKey)
        do {
            try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
            // An actor can process deletion or opt-out while the system add is suspended.
            if ticket != invalidation || sessionTicket != sessionInvalidations[sessionId, default: 0] {
                center.removePendingNotificationRequests(withIdentifiers: [identifier])
                center.removeDeliveredNotifications(withIdentifiers: [identifier])
                return false
            }
            return true
        } catch { return false }
    }

    func removeSession(_ sessionId: String) {
        sessionInvalidations[sessionId, default: 0] += 1
        var identities = defaults.dictionary(forKey: identitiesKey) as? [String: [String]] ?? [:]
        let ids = identities.removeValue(forKey: sessionId) ?? []
        defaults.set(identities, forKey: identitiesKey)
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    func removeAll() {
        invalidation += 1
        let identities = defaults.dictionary(forKey: identitiesKey) as? [String: [String]] ?? [:]
        let ids = identities.values.flatMap { $0 }
        defaults.removeObject(forKey: identitiesKey)
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }
}
