#if OROT_TESTS
    import UIKit

    /// An opt-in observer balances device notification generation while the app is active.
    @MainActor final class NavigationRotationProbe: NSObject {
        static let shared = NavigationRotationProbe()
        private var running = false
        private var beforeStart = false
        private var afterStart = false
        private var lastAtMs: Double?
        private var lastOrientation: Int?

        override private init() {
            super.init()
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(changed), name: UIDevice.orientationDidChangeNotification, object: nil)
            center.addObserver(self, selector: #selector(stop), name: UIApplication.didEnterBackgroundNotification, object: nil)
            center.addObserver(self, selector: #selector(stop), name: UIApplication.willTerminateNotification, object: nil)
        }

        /// Capture the prior generation state; each start is paired with a background or termination stop.
        func snapshot() -> [String: Any] {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_DEVICE_ORIENTATION_PROBE") == "YES" else { return ["enabled": false] }
            let device = UIDevice.current
            if !running {
                beforeStart = device.isGeneratingDeviceOrientationNotifications
                device.beginGeneratingDeviceOrientationNotifications()
                running = true
                afterStart = device.isGeneratingDeviceOrientationNotifications
                lastAtMs = nil
                lastOrientation = nil
            }
            return ["enabled": true, "generatingBeforeStart": beforeStart, "generatingAfterStart": afterStart,
                    "generatingNow": device.isGeneratingDeviceOrientationNotifications,
                    "lastNotificationAtMs": lastAtMs as Any? ?? NSNull(), "lastNotificationOrientation": lastOrientation as Any? ?? NSNull()]
        }

        @objc private func changed() {
            guard running else { return }
            lastAtMs = Date().timeIntervalSince1970 * 1000
            lastOrientation = UIDevice.current.orientation.rawValue
        }

        @objc private func stop() {
            guard running else { return }
            UIDevice.current.endGeneratingDeviceOrientationNotifications()
            running = false
        }
    }
#endif
