import Foundation
import React

/// The bridge exchanges opaque identities and local previews only; it never logs answer text.
@objc(ReplyNotificationModule)
final class ReplyNotificationModule: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(read:rejecter:)
    func read(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await resolve(ReplyNotificationService.shared.read()) }
    }

    @objc(save:resolver:rejecter:)
    func save(_ value: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        guard let enabled = value["enabled"] as? Bool, let preview = value["preview"] as? Bool else {
            resolve("error")
            return
        }
        Task { await resolve(ReplyNotificationService.shared.save(enabled: enabled, preview: preview)) }
    }

    @objc(authorized:rejecter:)
    func authorized(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await resolve(ReplyNotificationService.shared.authorized()) }
    }

    @objc(lease:resolver:rejecter:)
    func lease(_ sessionId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await resolve(ReplyNotificationService.shared.lease(sessionId: sessionId)) }
    }

    @objc(submit:resolver:rejecter:)
    func submit(_ value: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        guard let request = value["requestId"] as? String, let session = value["sessionId"] as? String,
              let message = value["messageId"] as? String, let version = value["sessionVersion"] as? Int,
              let preview = value["preview"] as? String, let lease = value["lease"] as? [String: Int],
              let ticket = lease["global"], let sessionTicket = lease["session"] else { resolve("suppressed"); return }
        Task { await resolve(ReplyNotificationService.shared.submit(requestId: request, sessionId: session, messageId: message, version: version, preview: preview, ticket: ticket, sessionTicket: sessionTicket)) }
    }

    @objc(removeSession:resolver:rejecter:)
    func removeSession(_ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await ReplyNotificationService.shared.removeSession(id); resolve(nil) }
    }

    @objc(removeAll:rejecter:)
    func removeAll(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { await ReplyNotificationService.shared.removeAll(); resolve(nil) }
    }

    @objc(consumeTarget:rejecter:)
    func consumeTarget(_ resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        resolve(AppointmentReminderDelivery.shared.consumeReplyTarget())
    }

    @objc(discardInvalidTarget:rejecter:)
    func discardInvalidTarget(_ resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        AppointmentReminderDelivery.shared.discardInvalidReplyTarget()
        resolve(nil)
    }

    @objc(acknowledgeTarget:resolver:rejecter:)
    func acknowledgeTarget(_ requestId: String, resolver resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        AppointmentReminderDelivery.shared.acknowledgeReplyTarget(requestId)
        resolve(nil)
    }
}
