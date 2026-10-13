#if OROT_TESTS
    import Foundation
    import React
    import UIKit

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
                        "gestures": recognizers.map { ["type": String(describing: type(of: $0)), "enabled": $0.isEnabled, "state": $0.state.rawValue] as [String: Any] },
                    ]
                }
                resolve(["navigation": observations, "events": self.gestureEvents,
                         "observerID": self.navigationObservationID, "atMs": Date().timeIntervalSince1970 * 1000])
            }
        }

        @objc private func observeNavigationGesture(_ recognizer: UIGestureRecognizer) {
            // Retain bounded structural events only; no screen text or health data is observed.
            gestureEvents.append(["type": String(describing: type(of: recognizer)), "state": recognizer.state.rawValue])
            if gestureEvents.count > 32 {
                gestureEvents.removeFirst(gestureEvents.count - 32)
            }
        }
    }
#endif
