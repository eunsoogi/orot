#if OROT_TESTS
    import Foundation
    import React
    import UIKit

    /// A bounded test-only timeline correlates bridge events with UIKit callbacks without changing either path.
    enum TestLifecycleObservation {
        private static let lock = NSLock()
        private static var events: [[String: Any]] = []

        static func record(_ event: String, fields: [String: Any] = [:]) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_NAVIGATION_OBSERVATION") == "YES"
                || UserDefaults.standard.string(forKey: "OROT_TEST_EXPORT_OBSERVATION") == "YES" else { return }
            lock.lock()
            defer { lock.unlock() }
            var observation = fields
            observation["event"] = event
            observation["receivedAtMs"] = Date().timeIntervalSince1970 * 1000
            events.append(observation)
            if events.count > 384 {
                events.removeFirst(events.count - 384)
            }
        }

        static func snapshot() -> [[String: Any]] {
            lock.lock()
            defer { lock.unlock() }
            return events
        }
    }

    /// The test entry consumes commands and returns observations through the normal RN native bridge.
    @objc(OrotTestControl)
    final class OrotTestControl: NSObject {
        private var observedGestures: Set<ObjectIdentifier> = []
        private var gestureEvents: [[String: Any]] = []
        private let navigationObservationID = UUID().uuidString

        @objc static func requiresMainQueueSetup() -> Bool {
            false
        }

        @objc(nextRequest:rejecter:)
        func nextRequest(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            TestOperationBroker.shared.next(resolve, reject: reject)
        }

        @objc(complete:result:)
        func complete(_ identifier: String, result: [String: Any]) {
            TestOperationBroker.shared.finish(identifier, result: .success(result))
        }

        @objc(fail:message:)
        func fail(_ identifier: String, message: String) {
            TestOperationBroker.shared.finish(identifier, result: .failure(TestOperationBroker.Failure.javascript(message)))
        }

        @objc(recordObservation:)
        func recordObservation(_ observation: [String: Any]) {
            guard let event = observation["event"] as? String else { return }
            TestLifecycleObservation.record(event, fields: observation)
        }

        /// Observe public UIKit navigation state while preserving recognizer configuration, delegates and route guards.
        @objc(navigationSnapshot:rejecter:)
        func navigationSnapshot(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
            DispatchQueue.main.async {
                var controllers: [UINavigationController] = []
                func visit(_ controller: UIViewController) {
                    if let navigation = controller as? UINavigationController {
                        controllers.append(navigation)
                    }
                    controller.children.forEach(visit)
                    if let presented = controller.presentedViewController {
                        visit(presented)
                    }
                }
                let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
                windows.filter(\.isKeyWindow).compactMap(\.rootViewController).forEach(visit)
                let observations = controllers.map { navigation -> [String: Any] in
                    let view = navigation.viewIfLoaded
                    let recognizers = view?.gestureRecognizers ?? []
                    for recognizer in recognizers where recognizer is UIPanGestureRecognizer {
                        if self.observedGestures.insert(ObjectIdentifier(recognizer)).inserted {
                            // An additional observation target never grants or overrides gesture permission.
                            recognizer.addTarget(self, action: #selector(self.observeNavigationGesture(_:)))
                        }
                    }
                    return [
                        "controller": String(describing: type(of: navigation)),
                        "depth": navigation.viewControllers.count,
                        "visible": view?.window != nil && view?.isHidden == false,
                        "transition": navigation.transitionCoordinator.map { ["interactive": $0.isInteractive, "cancelled": $0.isCancelled, "percentComplete": $0.percentComplete] as [String: Any] } ?? [:],
                        "gestures": recognizers.map { ["type": String(describing: type(of: $0)), "enabled": $0.isEnabled, "state": $0.state.rawValue] as [String: Any] },
                    ]
                }
                resolve(["navigation": observations, "events": self.gestureEvents,
                         "lifecycle": TestLifecycleObservation.snapshot(),
                         "observerID": self.navigationObservationID, "atMs": Date().timeIntervalSince1970 * 1000])
            }
        }

        @objc private func observeNavigationGesture(_ recognizer: UIGestureRecognizer) {
            TestLifecycleObservation.record("uikit-gesture", fields: ["type": String(describing: type(of: recognizer)), "state": recognizer.state.rawValue])
            // Retain bounded structural events only; no screen text or health data is observed.
            gestureEvents.append(["type": String(describing: type(of: recognizer)), "state": recognizer.state.rawValue])
            if gestureEvents.count > 32 {
                gestureEvents.removeFirst(gestureEvents.count - 32)
            }
        }
    }
#endif
