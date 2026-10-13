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
        // Weak UIKit identity keeps IDs stable while alive without extending a controller or recognizer's lifetime.
        private let observationIDs = NSMapTable<NSObject, NSString>(keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory)
        private let observedNavigations = NSHashTable<UINavigationController>.weakObjects()
        private let observedGestures = NSHashTable<UIGestureRecognizer>.weakObjects()
        private var observationSequence = 0
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
                    let navigationID = self.observationIdentifier(navigation, prefix: "navigation")
                    self.observedNavigations.add(navigation)
                    let view = navigation.viewIfLoaded
                    let recognizers = view?.gestureRecognizers ?? []
                    for recognizer in recognizers where recognizer is UIPanGestureRecognizer {
                        if !self.observedGestures.contains(recognizer) {
                            self.observedGestures.add(recognizer)
                            // An additional observation target never grants or overrides gesture permission.
                            recognizer.addTarget(self, action: #selector(self.observeNavigationGesture(_:)))
                        }
                    }
                    return [
                        "controller": String(describing: type(of: navigation)),
                        "controllerID": navigationID,
                        "depth": navigation.viewControllers.count,
                        "visible": view?.window != nil && view?.isHidden == false,
                        "viewBounds": view.map { ["width": $0.bounds.width, "height": $0.bounds.height] } ?? [:],
                        "transition": navigation.transitionCoordinator.map { ["interactive": $0.isInteractive, "cancelled": $0.isCancelled, "percentComplete": $0.percentComplete] as [String: Any] } ?? [:],
                        "gestures": recognizers.map { ["recognizerID": self.observationIdentifier($0, prefix: "gesture"), "roles": self.publicPopRoles($0, navigation: navigation), "type": String(describing: type(of: $0)), "enabled": $0.isEnabled, "state": $0.state.rawValue] as [String: Any] },
                    ]
                }
                resolve(["navigation": observations, "events": self.gestureEvents,
                         "lifecycle": TestLifecycleObservation.snapshot(),
                         "observerID": self.navigationObservationID, "atMs": Date().timeIntervalSince1970 * 1000])
            }
        }

        @objc private func observeNavigationGesture(_ recognizer: UIGestureRecognizer) {
            // Resolve current public view ownership: a recognizer may move after its observation target was installed.
            let knownNavigations = observedNavigations.allObjects
            let owners = recognizer.view.map { view in knownNavigations.filter { $0.viewIfLoaded === view } } ?? []
            let owner = owners.count == 1 ? owners.first : nil
            var fields: [String: Any] = [
                "type": String(describing: type(of: recognizer)), "state": recognizer.state.rawValue,
                "recognizerID": observationIdentifier(recognizer, prefix: "gesture"),
                "controllerID": owner.map { observationIdentifier($0, prefix: "navigation") } ?? (owners.isEmpty ? "unknown" : "ambiguous"),
                "viewOwnerControllerIDs": owners.map { observationIdentifier($0, prefix: "navigation") },
                "controllerDepth": owner.map(\.viewControllers.count) as Any? ?? NSNull(),
                "publicPopControllers": knownNavigations.compactMap { navigation -> [String: Any]? in
                    let roles = publicPopRoles(recognizer, navigation: navigation)
                    return roles.isEmpty ? nil : ["controllerID": observationIdentifier(navigation, prefix: "navigation"), "roles": roles]
                },
            ]
            if let pan = recognizer as? UIPanGestureRecognizer, let view = pan.view {
                // UIKit reports distance and velocity in this owning view's points and points/second, not screenshot pixels.
                fields["translationX"] = pan.translation(in: view).x
                fields["translationY"] = pan.translation(in: view).y
                fields["velocityX"] = pan.velocity(in: view).x
                fields["velocityY"] = pan.velocity(in: view).y
                fields["viewWidth"] = view.bounds.width
                fields["viewHeight"] = view.bounds.height
            }
            fields["atMs"] = Date().timeIntervalSince1970 * 1000
            TestLifecycleObservation.record("uikit-gesture", fields: fields)
            // Retain bounded structural events only; no screen text or health data is observed.
            gestureEvents.append(fields)
            if gestureEvents.count > 32 {
                gestureEvents.removeFirst(gestureEvents.count - 32)
            }
        }

        private func observationIdentifier(_ object: NSObject, prefix: String) -> String {
            if let existing = observationIDs.object(forKey: object) {
                return existing as String
            }
            observationSequence += 1
            let identifier = "\(prefix)-\(observationSequence)"
            observationIDs.setObject(identifier as NSString, forKey: object)
            return identifier
        }

        private func publicPopRoles(_ recognizer: UIGestureRecognizer, navigation: UINavigationController) -> [String] {
            var roles: [String] = []
            if recognizer === navigation.interactivePopGestureRecognizer {
                roles.append("edge-pop")
            }
            if #available(iOS 26, *), recognizer === navigation.interactiveContentPopGestureRecognizer {
                roles.append("content-pop")
            }
            return roles
        }
    }
#endif
