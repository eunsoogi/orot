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

/// Daily observation is admitted separately; ordinary products have no diagnostic effect.
@inline(__always)
func recordDailyReminderDiagnostic(_ stage: AppointmentReminderDiagnosticStage,
                                   authorization: AppointmentReminderDiagnosticAuthorization? = nil, error: Error? = nil)
{
    #if OROT_TESTS
        guard DailyReminderDiagnostic.enabled else { return }
        AppointmentReminderDiagnosticTrace.record(stage, authorization: authorization, error: error)
    #endif
}

#if OROT_TESTS
    /// Reuse the bounded domain/code encoder; never record request contents or NSError userInfo.
    enum DailyReminderDiagnostic {
        static var enabled: Bool {
            ProcessInfo.processInfo.environment["OROT_TEST_DAILY_REMINDER_DIAGNOSTICS"] == "YES" &&
                AppointmentReminderDiagnosticTrace.enabledRunID != nil
        }

        /// Exactly one original add, with the same rejection identity and no retry or scheduling changes.
        static func aroundAdd(enabled: Bool? = nil,
                              emit: (AppointmentReminderDiagnosticStage, Error?) -> Void = { stage, error in
                                  recordDailyReminderDiagnostic(stage, error: error)
                              }, operation: () async throws -> Void) async throws
        {
            try await AppointmentReminderDiagnosticTrace.aroundAdd(
                emit: emit, enabled: enabled ?? Self.enabled, operation: operation,
            )
        }
    }
#endif
