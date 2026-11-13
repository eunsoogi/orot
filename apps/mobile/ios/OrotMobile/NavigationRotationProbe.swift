#if OROT_TESTS
    import React
    import UIKit

    /// An opt-in observer balances device notification generation while the app is active.
    @MainActor final class NavigationRotationProbe: NSObject {
        static let shared = NavigationRotationProbe()
        private var running = false
        private var beforeStart = false
        private var afterStart = false
        private var lastAtMs: Double?
        private var lastOrientation: Int?
        private var geometrySession = ""
        private var geometryStartedAt: Double = 0
        private var geometryEvents: [[String: Any]] = []
        private var geometryRequestCount = 0
        private var geometryRequestedAt: Double?
        private var geometryError: [String: Any] = [:]
        private weak var geometryScene: UIWindowScene?
        private var initialBounds = CGRect.zero
        private var initialSceneOrientation = 0

        override private init() {
            super.init()
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(changed), name: UIDevice.orientationDidChangeNotification, object: nil)
            center.addObserver(self, selector: #selector(stop), name: UIApplication.didEnterBackgroundNotification, object: nil)
            center.addObserver(self, selector: #selector(stop), name: UIApplication.willTerminateNotification, object: nil)
        }

        /// Correlate scene callbacks and the single supported request without recording screen content.
        @available(iOS 16.0, *)
        func geometryCommand(session: String, mode: String) -> [String: Any] {
            guard UUID(uuidString: session) != nil else { return ["status": "invalid-session"] }
            if mode == "start" {
                geometrySession = session; geometryStartedAt = Date().timeIntervalSince1970 * 1000
                geometryEvents = []; geometryRequestCount = 0; geometryRequestedAt = nil; geometryError = [:]
            }
            guard session == geometrySession else { return ["status": "wrong-session"] }
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter { $0.isKeyWindow && !$0.isHidden }
            guard windows.count == 1, let window = windows.first, let scene = window.windowScene else { return ["status": "unavailable", "session": session] }
            if mode == "start" {
                geometryScene = scene; initialBounds = window.bounds
                initialSceneOrientation = scene.effectiveGeometry.interfaceOrientation.rawValue
            }
            guard geometryScene === scene else { return ["status": "scene-changed", "session": session] }
            let changed = geometryEvents.contains { event in
                (event["sceneOrientation"] as? Int) != initialSceneOrientation ||
                    (event["width"] as? CGFloat) != initialBounds.width || (event["height"] as? CGFloat) != initialBounds.height
            }
            if mode == "request", !changed, geometryRequestCount == 0 {
                geometryRequestCount = 1
                geometryRequestedAt = Date().timeIntervalSince1970 * 1000
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { [weak self] error in
                    DispatchQueue.main.async {
                        guard self?.geometrySession == session else { return }
                        let value = error as NSError
                        self?.geometryError = ["code": value.code, "atMs": Date().timeIntervalSince1970 * 1000]
                    }
                }
            }
            return ["status": "sampled", "mode": mode, "session": session, "startedAtMs": geometryStartedAt,
                    "requestedAtMs": geometryRequestedAt as Any? ?? NSNull(), "sampledAtMs": Date().timeIntervalSince1970 * 1000,
                    "requestCount": geometryRequestCount, "error": geometryError, "events": geometryEvents,
                    "windowBounds": ["x": window.bounds.minX, "y": window.bounds.minY, "width": window.bounds.width, "height": window.bounds.height],
                    "safeAreaInsets": ["top": window.safeAreaInsets.top, "right": window.safeAreaInsets.right, "bottom": window.safeAreaInsets.bottom, "left": window.safeAreaInsets.left],
                    "sceneOrientation": scene.effectiveGeometry.interfaceOrientation.rawValue,
                    "deviceOrientation": UIDevice.current.orientation.rawValue]
        }

        /// The delegate callback carries previous geometry; record the scene's current geometry instead.
        @available(iOS 16.0, *)
        func geometryChanged(_ scene: UIWindowScene) {
            guard !geometrySession.isEmpty, geometryScene === scene, let window = scene.windows.first(where: { $0.isKeyWindow && !$0.isHidden }) else { return }
            let session = geometrySession
            let at = Date().timeIntervalSince1970 * 1000
            var event: [String: Any] = ["atMs": at, "sceneOrientation": scene.effectiveGeometry.interfaceOrientation.rawValue,
                                        "width": window.bounds.width, "height": window.bounds.height, "transition": "unavailable",
                                        "safeAreaInsets": ["top": window.safeAreaInsets.top, "right": window.safeAreaInsets.right, "bottom": window.safeAreaInsets.bottom, "left": window.safeAreaInsets.left]]
            if let coordinator = window.rootViewController?.transitionCoordinator {
                event["transition"] = "pending"
                let registered = coordinator.animate(alongsideTransition: nil) { [weak self, weak scene, weak window] context in
                    guard let self, geometrySession == session, let scene, let window else { return }
                    geometryEvents.append(["atMs": Date().timeIntervalSince1970 * 1000, "sceneOrientation": scene.effectiveGeometry.interfaceOrientation.rawValue,
                                           "width": window.bounds.width, "height": window.bounds.height, "transition": "completed", "cancelled": context.isCancelled,
                                           "safeAreaInsets": ["top": window.safeAreaInsets.top, "right": window.safeAreaInsets.right, "bottom": window.safeAreaInsets.bottom, "left": window.safeAreaInsets.left]])
                }
                if !registered {
                    event["transition"] = "unavailable"
                }
            }
            geometryEvents.append(event)
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

    extension OrotTestControl {
        /// The request is dispatched to UIKit's main thread and returns an allowlisted receipt.
        @objc(rotationGeometryCommand:mode:resolve:rejecter:)
        func rotationGeometryCommand(_ session: String, mode: String, resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
            DispatchQueue.main.async {
                guard #available(iOS 16.0, *) else { resolve(["status": "unavailable"]); return }
                resolve(NavigationRotationProbe.shared.geometryCommand(session: session, mode: mode))
            }
        }
    }
#endif
