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
            // Emit compact export boundaries to stdout; capture availability depends on the runner. Periodic snapshots stay local.
            if event.hasPrefix("export-"), UserDefaults.standard.string(forKey: "OROT_TEST_EXPORT_OBSERVATION") == "YES",
               let data = try? JSONSerialization.data(withJSONObject: observation), let text = String(data: data, encoding: .utf8)
            {
                print("OROT_TEST_EXPORT_EVENT \(text)")
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
    final class OrotTestControl: RCTEventEmitter {
        // Weak UIKit identity keeps IDs stable while alive without extending a controller or recognizer's lifetime.
        private let observationIDs = NSMapTable<NSObject, NSString>(keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory)
        private let observedNavigations = NSHashTable<UINavigationController>.weakObjects()
        private let observedGestures = NSHashTable<UIGestureRecognizer>.weakObjects()
        private var observationSequence = 0
        private var gestureEvents: [[String: Any]] = []
        private let navigationObservationID = UUID().uuidString

        @objc override static func requiresMainQueueSetup() -> Bool {
            false
        }

        override func supportedEvents() -> [String]! {
            ["appearanceRefreshed"]
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

        @objc(speechSnapshot:rejecter:)
        func speechSnapshot(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
            resolve(TestSpeechObservation.snapshot())
        }

        /// Register the isolated test refresh channel and expose actual UIKit observations through the usual RN bridge.
        @objc(refreshAppearance:rejecter:)
        func refreshAppearance(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            DispatchQueue.main.async {
                guard UserDefaults.standard.string(forKey: "OROT_TEST_APPEARANCE_OBSERVATION") == "YES",
                      let session = UserDefaults.standard.string(forKey: "OROT_TEST_APPEARANCE_SESSION"), UUID(uuidString: session) != nil,
                      let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow)
                else {
                    reject("appearance_unavailable", "An opted-in foreground test window is required", nil)
                    return
                }
                resolve(TestAppearanceRefresh.shared.observe(window: window, session: session) { [weak self] observation in
                    self?.sendEvent(withName: "appearanceRefreshed", body: observation)
                })
            }
        }

        /// Observe public UIKit navigation state while preserving recognizer configuration, delegates and route guards.
        @objc(navigationSnapshot:rejecter:)
        func navigationSnapshot(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
            DispatchQueue.main.async {
                var controllers: [UINavigationController] = []
                var presentations: [[String: Any]] = []
                func visit(_ controller: UIViewController) {
                    if let navigation = controller as? UINavigationController {
                        controllers.append(navigation)
                    }
                    if let activity = controller as? UIActivityViewController {
                        presentations.append(self.presentationObservation(activity))
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
                         "presentations": presentations,
                         "lifecycle": TestLifecycleObservation.snapshot(),
                         "observerID": self.navigationObservationID, "atMs": Date().timeIntervalSince1970 * 1000])
            }
        }

        /// Public window/container coordinates distinguish presentation bounds from the full-screen dismiss region.
        private func presentationObservation(_ activity: UIActivityViewController) -> [String: Any] {
            let view = activity.viewIfLoaded
            let window = view?.window
            let presentation = activity.presentationController
            return [
                "controllerID": observationIdentifier(activity, prefix: "activity"),
                "hasPresenter": activity.presentingViewController != nil,
                "beingPresented": activity.isBeingPresented, "beingDismissed": activity.isBeingDismissed,
                "viewInWindow": windowRect(view),
                "presentedViewInWindow": windowRect(presentation?.presentedView),
                "containerInWindow": windowRect(presentation?.containerView),
                "windowBounds": window.map { rectObservation($0.bounds) } ?? [:],
                "windowSafeArea": window.map { rectObservation($0.safeAreaLayoutGuide.layoutFrame) } ?? [:],
                "frameInContainer": presentation.map { rectObservation($0.frameOfPresentedViewInContainerView) } ?? [:],
            ]
        }

        private func windowRect(_ view: UIView?) -> [String: CGFloat] {
            guard let view, let window = view.window else { return [:] }
            return rectObservation(view.convert(view.bounds, to: window))
        }

        private func rectObservation(_ rect: CGRect) -> [String: CGFloat] {
            ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
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
