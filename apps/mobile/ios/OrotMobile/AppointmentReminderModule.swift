import Foundation
import React

@objc(AppointmentReminderModule)
public final class AppointmentReminderModule: RCTEventEmitter {
    private var observer: NSObjectProtocol?

    @objc override public static func requiresMainQueueSetup() -> Bool { false }

    override public func supportedEvents() -> [String]! { ["appointmentReminderOpened"] }

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
            if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
            self.observer = nil
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
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
            do {
                try await AppointmentReminderNotifications.shared.writeSelection(value as? [String: Any])
                resolve(nil)
            } catch { reject("REMINDER_SELECTION_FAILED", "The reminder preference could not be saved.", nil) }
        }
    }

    @objc(authorizationStatus:rejecter:)
    public func authorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        Task { resolve(await AppointmentReminderNotifications.shared.authorizationStatus()) }
    }

    @objc(requestAuthorization:rejecter:)
    public func requestAuthorization(
        _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task {
            do { resolve(try await AppointmentReminderNotifications.shared.requestAuthorization()) }
            catch { reject("REMINDER_PERMISSION_FAILED", "Notification authorization could not be checked.", nil) }
        }
    }

    @objc(replace:resolver:rejecter:)
    public func replace(
        _ value: NSDictionary?, resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task {
            do {
                let plan = try value.map(AppointmentReminderNotificationPlan.init)
                try await AppointmentReminderNotifications.shared.replace(plan)
                resolve(nil)
            } catch { reject("REMINDER_SCHEDULE_FAILED", "The local reminder could not be updated.", nil) }
        }
    }

    @objc(consumeTarget:rejecter:)
    public func consumeTarget(_ resolve: RCTPromiseResolveBlock, rejecter _: RCTPromiseRejectBlock) {
        resolve(AppointmentReminderDelivery.shared.consumeTarget() as Any? ?? NSNull())
    }
}
