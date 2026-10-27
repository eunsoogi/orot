import Foundation
import React

enum AppointmentReminderDiagnosticStage: String, Codable {
    case diagnosticReady = "diagnostic-ready"
    case bridgeEnter = "bridge-enter"
    case bridgeResolve = "bridge-resolve"
    case bridgeReject = "bridge-reject"
    case selectionWriteEnter = "selection-write-enter"
    case selectionWriteResolve = "selection-write-resolve"
    case selectionWriteReject = "selection-write-reject"
    case requestAuthorizationEnter = "request-authorization-enter"
    case requestAuthorizationResolve = "request-authorization-resolve"
    case requestAuthorizationReject = "request-authorization-reject"
    case permissionRequestEnter = "permission-request-enter"
    case permissionRequestResolve = "permission-request-resolve"
    case permissionRequestReject = "permission-request-reject"
    case authorizationObserved = "authorization-observed"
    case planValidationEnter = "plan-validation-enter"
    case planValidationResolve = "plan-validation-resolve"
    case planValidationReject = "plan-validation-reject"
    case expiryCheck = "expiry-check"
    case expiryReject = "expiry-reject"
    case authorizationCheck = "authorization-check"
    case authorizationReject = "authorization-reject"
    case triggerCheck = "trigger-check"
    case triggerResolve = "trigger-resolve"
    case triggerReject = "trigger-reject"
    case centerAddEnter = "center-add-enter"
    case centerAddResolve = "center-add-resolve"
    case centerAddReject = "center-add-reject"
    case cancel
}

enum AppointmentReminderDiagnosticAuthorization: String, Codable {
    case authorized
    case notDetermined
    case denied
    case unknown

    init(status: String) {
        switch status {
        case "authorized": self = .authorized
        case "notDetermined": self = .notDetermined
        case "denied": self = .denied
        default: self = .unknown
        }
    }
}

/// Ordinary products compile this boundary to a no-op; diagnostic writes also require the explicit launch flag.
@inline(__always)
func recordAppointmentReminderDiagnostic(
    _ stage: AppointmentReminderDiagnosticStage,
    nullPlan: Bool? = nil,
    authorization: AppointmentReminderDiagnosticAuthorization? = nil,
    error: Error? = nil,
) {
    #if OROT_TESTS
        AppointmentReminderDiagnosticTrace.record(
            stage,
            nullPlan: nullPlan,
            authorization: authorization,
            error: error,
        )
    #endif
}

/// Keep opaque invocation ownership task-local across actor calls without changing bridge arguments.
func withAppointmentReminderDiagnosticOperation(_ operation: () async -> Void) async {
    #if OROT_TESTS
        await AppointmentReminderDiagnosticTrace.withOperation(operation)
    #else
        await operation()
    #endif
}

extension AppointmentReminderNotifications {
    /// Keep fixed test-trace forwarding out of the scheduling flow; ordinary builds reduce it to a no-op.
    func trace(
        _ stage: AppointmentReminderDiagnosticStage,
        nullPlan: Bool? = nil,
        authorization: AppointmentReminderDiagnosticAuthorization? = nil,
        error: Error? = nil,
    ) {
        recordAppointmentReminderDiagnostic(stage, nullPlan: nullPlan, authorization: authorization, error: error)
    }
}

@objc(AppointmentReminderModule)
public final class AppointmentReminderModule: RCTEventEmitter {
    private var observer: NSObjectProtocol?

    @objc override public static func requiresMainQueueSetup() -> Bool {
        false
    }

    override public func supportedEvents() -> [String]! {
        ["appointmentReminderOpened"]
    }

    override public func startObserving() {
        // React invokes module methods on its own queue; event delivery uses main.
        // Confine observer ownership to main rather than sharing mutable state.
        DispatchQueue.main.async { [weak self] in self?.installObserver() }
    }

    private func installObserver() {
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(
            forName: AppointmentReminderDelivery.changed, object: nil, queue: .main,
        ) { [weak self] _ in
            self?.sendEvent(withName: "appointmentReminderOpened", body: nil)
        }
        // Install the observer before checking the inbox. A tap between the JS
        // initial drain and native listener setup must still produce a wake signal.
        if AppointmentReminderDelivery.shared.hasPendingTarget() {
            sendEvent(withName: "appointmentReminderOpened", body: nil)
        }
    }

    override public func stopObserving() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let observer {
                NotificationCenter.default.removeObserver(observer)
            }
            observer = nil
        }
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    @objc(readSelection:rejecter:)
    public func readSelection(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task {
            let value = await AppointmentReminderNotifications.shared.readSelection()
            resolve(value as Any? ?? NSNull())
        }
    }

    @objc(writeSelection:resolver:rejecter:)
    public func writeSelection(
        _ value: NSDictionary?, resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task {
            await withAppointmentReminderDiagnosticOperation {
                recordAppointmentReminderDiagnostic(.selectionWriteEnter)
                do {
                    try await AppointmentReminderNotifications.shared.writeSelection(value as? [String: Any])
                    resolve(nil)
                    recordAppointmentReminderDiagnostic(.selectionWriteResolve)
                } catch {
                    recordAppointmentReminderDiagnostic(.selectionWriteReject, error: error)
                    reject("REMINDER_SELECTION_FAILED", "The reminder preference could not be saved.", appointmentReminderFailureOriginCarrier())
                }
            }
        }
    }

    @objc(authorizationStatus:rejecter:)
    public func authorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task {
            await withAppointmentReminderDiagnosticOperation {
                await resolve(AppointmentReminderNotifications.shared.authorizationStatus())
            }
        }
    }

    @objc(requestAuthorization:rejecter:)
    public func requestAuthorization(
        _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task {
            await withAppointmentReminderDiagnosticOperation {
                recordAppointmentReminderDiagnostic(.requestAuthorizationEnter)
                do {
                    let status = try await AppointmentReminderNotifications.shared.requestAuthorization()
                    resolve(status)
                    recordAppointmentReminderDiagnostic(
                        .requestAuthorizationResolve,
                        authorization: .init(status: status),
                    )
                } catch {
                    recordAppointmentReminderDiagnostic(.requestAuthorizationReject, error: error)
                    reject("REMINDER_PERMISSION_FAILED", "Notification authorization could not be checked.", appointmentReminderFailureOriginCarrier())
                }
            }
        }
    }

    @objc(replace:resolver:rejecter:)
    public func replace(
        _ value: NSDictionary?, resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task {
            await withAppointmentReminderDiagnosticOperation {
                recordAppointmentReminderDiagnostic(.bridgeEnter, nullPlan: value == nil)
                recordAppointmentReminderDiagnostic(.planValidationEnter, nullPlan: value == nil)
                let plan: AppointmentReminderNotificationPlan?
                do {
                    #if OROT_TESTS
                        try AppointmentReminderFailureOrigin.failControlReplaceIfEnabled()
                    #endif
                    plan = try value.map(AppointmentReminderNotificationPlan.init)
                    recordAppointmentReminderDiagnostic(.planValidationResolve, nullPlan: value == nil)
                } catch {
                    recordAppointmentReminderDiagnostic(.planValidationReject, error: error)
                    recordAppointmentReminderDiagnostic(.bridgeReject, error: error)
                    reject("REMINDER_SCHEDULE_FAILED", "The local reminder could not be updated.", appointmentReminderFailureOriginCarrier())
                    return
                }
                do {
                    try await AppointmentReminderNotifications.shared.replace(plan)
                    resolve(nil)
                    recordAppointmentReminderDiagnostic(.bridgeResolve, nullPlan: value == nil)
                } catch {
                    recordAppointmentReminderDiagnostic(.bridgeReject, error: error)
                    reject("REMINDER_SCHEDULE_FAILED", "The local reminder could not be updated.", appointmentReminderFailureOriginCarrier())
                }
            }
        }
    }

    @objc(consumeTarget:rejecter:)
    public func consumeTarget(_ resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        resolve(AppointmentReminderDelivery.shared.consumeTarget() as Any? ?? NSNull())
    }
}
