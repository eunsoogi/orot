#if (OROT_RECORDING_METERING_SIMULATOR_TEST || OROT_TESTS) && targetEnvironment(simulator)
    import AVFoundation
    import Foundation
    import UIKit

    /// Serializes permission and UIKit activation on the main queue before the diagnostic recorder starts.
    final class RecordingMeteringPermission {
        private let notifications: NotificationCenter
        private let requestPermission: (@escaping (Bool) -> Void) -> Void
        private var active: Bool
        private var granted: Bool?
        private var completion: ((Bool) -> Void)?
        private var observers: [NSObjectProtocol] = []
        private var started = false

        convenience init() {
            let undetermined: Bool = if #available(iOS 17.0, *) {
                AVAudioApplication.shared.recordPermission == .undetermined
            } else {
                AVAudioSession.sharedInstance().recordPermission == .undetermined
            }
            // A first permission reply can precede the sheet's inactive/active notifications.
            // Its pre-prompt .active state must not authorize capture during that transition.
            self.init(requiresActivation: undetermined || UIApplication.shared.applicationState != .active,
                      notifications: .default)
            { callback in
                if #available(iOS 17.0, *) {
                    AVAudioApplication.requestRecordPermission(completionHandler: callback)
                } else {
                    AVAudioSession.sharedInstance().requestRecordPermission(callback)
                }
            }
        }

        init(requiresActivation: Bool, notifications: NotificationCenter, requestPermission: @escaping (@escaping (Bool) -> Void) -> Void) {
            dispatchPrecondition(condition: .onQueue(.main))
            active = !requiresActivation
            self.notifications = notifications
            self.requestPermission = requestPermission
        }

        deinit {
            observers.forEach(notifications.removeObserver)
        }

        func request(_ completion: @escaping (Bool) -> Void) {
            dispatchPrecondition(condition: .onQueue(.main))
            precondition(!started, "A microphone permission operation is single-use.")
            started = true
            self.completion = completion
            // Register before asking: activation and the permission reply may arrive in either order.
            for (name, isActive) in [(UIApplication.didBecomeActiveNotification, true), (UIApplication.willResignActiveNotification, false)] {
                observers.append(notifications.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    self?.active = isActive
                    self?.resolveIfReady()
                })
            }
            requestPermission { [weak self] allowed in
                // The system is allowed to deliver its reply off the main thread.
                DispatchQueue.main.async {
                    self?.granted = allowed
                    self?.resolveIfReady()
                }
            }
        }

        func cancel() {
            dispatchPrecondition(condition: .onQueue(.main))
            complete(false)
        }

        private func resolveIfReady() {
            guard let granted, !granted || active else { return }
            complete(granted)
        }

        private func complete(_ allowed: Bool) {
            guard let callback = completion else { return }
            completion = nil
            observers.forEach(notifications.removeObserver)
            observers.removeAll()
            // Clear ownership before invoking the caller, including cancellation and reentrant callbacks.
            callback(allowed)
        }
    }
#endif
