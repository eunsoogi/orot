import Foundation
import React

/// Exposes configuration and reconciliation without coupling notification delivery to AI.
@objc(DailyReminderModule)
final class DailyReminderModule: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(read:rejecter:)
    func read(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await resolve(DailyReminderNotifications.shared.read() as Any? ?? NSNull()) }
    }

    @objc(save:resolver:rejecter:)
    func save(_ value: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await resolve(DailyReminderNotifications.shared.save(value as? [String: Any] ?? [:])) }
    }

    @objc(reconcile:rejecter:)
    func reconcile(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await resolve(DailyReminderNotifications.shared.reconcile()) }
    }
}
