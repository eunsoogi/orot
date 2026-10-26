#if OROT_TESTS
    import Foundation
    import React
    import UIKit
    import UserNotifications

    /// Read-only OS receipts are available only in explicitly opted-in test products.
    /// They never create appointments, authorize notifications, or inject delivery events.
    @objc(OrotReminderTestObservation)
    final class OrotReminderTestObservation: NSObject {
        @objc static func requiresMainQueueSetup() -> Bool {
            false
        }

        @objc(snapshot:rejecter:)
        func snapshot(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_REMINDER_OBSERVATION") == "YES" else {
                reject("observation_disabled", "Reminder observation was not enabled", nil)
                return
            }
            let requestedAtMs = Date().timeIntervalSince1970 * 1000
            Task {
                let center = UNUserNotificationCenter.current()
                let settings = await center.notificationSettings()
                let pending = await center.pendingNotificationRequests()
                let delivered = await center.deliveredNotifications()
                await MainActor.run {
                    let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                        .flatMap(\.windows).first(where: \.isKeyWindow)
                    resolve([
                        "status": "observed", "processID": ProcessInfo.processInfo.processIdentifier,
                        "atMs": requestedAtMs,
                        "authorization": settings.authorizationStatus.rawValue,
                        "pending": pending.filter(Self.owned).map(Self.request),
                        "delivered": delivered.filter { Self.owned($0.request) }.map {
                            ["request": Self.request($0.request), "deliveredAtMs": $0.date.timeIntervalSince1970 * 1000]
                        },
                        "contentSizeCategory": window?.traitCollection.preferredContentSizeCategory.rawValue ?? "unavailable",
                        "contrast": window?.traitCollection.accessibilityContrast.rawValue ?? 0,
                        "systemDarkerColors": UIAccessibility.isDarkerSystemColorsEnabled,
                        "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
                        "contrastStrategy": "system-accessibility-setting",
                    ])
                }
            }
        }

        private static func owned(_ request: UNNotificationRequest) -> Bool {
            request.identifier == AppointmentReminderNotifications.requestIdentifier
        }

        /// The feature-owned request exposes only opaque routing metadata and its actual safe content.
        private static func request(_ request: UNNotificationRequest) -> [String: Any] {
            let next = (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate()
            return [
                "identifier": request.identifier,
                "appointmentId": request.content.userInfo["appointmentId"] as? String ?? "",
                "timeKey": request.content.userInfo["timeKey"] as? String ?? "",
                "userInfoKeys": request.content.userInfo.keys.compactMap { $0 as? String }.sorted(),
                "title": request.content.title, "body": request.content.body,
                "nextTriggerAtMs": next.map { $0.timeIntervalSince1970 * 1000 } as Any? ?? NSNull(),
            ]
        }
    }

#endif
