#if OROT_TESTS
    import UIKit

    /// Records only opt-in mount and layout changes; observations never alter the selected host or controls.
    enum NavigationRailMountTestObservation {
        private static let ids = NSMapTable<NSObject, NSString>(keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory)
        private static var sequence = 0
        private static var last: [String: Data] = [:]
        private static var keyboardObserver: NSObjectProtocol?
        private static var lastKeyboardFrame: Data?
        static var enabled: Bool {
            UserDefaults.standard.string(forKey: "OROT_TEST_DUO_RAIL_MOUNT_OBSERVATION") == "YES"
        }

        static func identity(_ object: NSObject) -> String {
            if let id = ids.object(forKey: object) {
                return id as String
            }
            sequence += 1
            let id = "rail-object-\(sequence)"
            ids.setObject(id as NSString, forKey: object)
            return id
        }

        static func mount(owner: UIView, portal: UIView, controller: UIViewController?, root: UIView?, target: CGRect?, reason: String) {
            guard enabled else { return }
            observeKeyboard()
            var fields = common(owner: owner, portal: portal)
            fields["reason"] = reason
            fields["controllerID"] = controller.map(identity) as Any? ?? NSNull()
            fields["controllerType"] = controller.map { String(describing: type(of: $0)) } as Any? ?? NSNull()
            fields["rootID"] = root.map(identity) as Any? ?? NSNull()
            fields["rootBounds"] = root.map { NavigationGeometryTestObservation.finiteRect($0.bounds) } as Any? ?? NSNull()
            fields["rootFrameInWindow"] = root.flatMap { view in view.window.map { NavigationGeometryTestObservation.finiteRect(view.convert(view.bounds, to: $0)) } } as Any? ?? NSNull()
            fields["targetInRoot"] = target.map(NavigationGeometryTestObservation.finiteRect) as Any? ?? NSNull()
            publish("rail-mount", fields: fields)
        }

        private static func observeKeyboard() {
            guard keyboardObserver == nil else { return }
            keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { notification in
                guard enabled else { return }
                let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
                let fields: [String: Any] = ["endFrameInScreen": frame.map(NavigationGeometryTestObservation.finiteRect) as Any? ?? NSNull()]
                guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]), data != lastKeyboardFrame else { return }
                lastKeyboardFrame = data
                TestLifecycleObservation.record("rail-keyboard-frame", fields: fields)
            }
        }

        static func layout(owner: NavigationGlassSurfaceView, portal: UIView) {
            guard enabled else { return }
            var fields = common(owner: owner, portal: portal)
            fields["layoutMode"] = owner.layoutMode
            fields["innerActionsID"] = identity(owner.innerActions)
            fields["innerActionsParentID"] = owner.innerActions.superview.map(identity) as Any? ?? NSNull()
            fields["innerActionsFrameInWindow"] = owner.window.map { NavigationGeometryTestObservation.finiteRect(owner.innerActions.convert(owner.innerActions.bounds, to: $0)) } as Any? ?? NSNull()
            fields["backControls"] = owner.innerActions.arrangedSubviews.compactMap { view -> [String: Any]? in
                guard let control = view as? UIControl, control.accessibilityIdentifier == "navigation-back" else { return nil }
                return ["id": identity(control), "parentID": control.superview.map(identity) as Any? ?? NSNull(),
                        "windowID": control.window.map(identity) as Any? ?? NSNull(), "hidden": control.isHidden,
                        "enabled": control.isEnabled, "isAccessibilityElement": control.isAccessibilityElement,
                        "frameInWindow": control.window.map { NavigationGeometryTestObservation.finiteRect(control.convert(control.bounds, to: $0)) } as Any? ?? NSNull(),
                        "accessibilityFrameInScreen": NavigationGeometryTestObservation.finiteRect(control.accessibilityFrame)]
            }
            publish("rail-layout", fields: fields)
        }

        private static func common(owner: UIView, portal: UIView) -> [String: Any] {
            ["ownerID": identity(owner), "ownerBounds": NavigationGeometryTestObservation.finiteRect(owner.bounds),
             "ownerWindowID": owner.window.map(identity) as Any? ?? NSNull(), "portalID": identity(portal),
             "ownerFrameInWindow": owner.window.map { NavigationGeometryTestObservation.finiteRect(owner.convert(owner.bounds, to: $0)) } as Any? ?? NSNull(),
             "portalParentID": portal.superview.map(identity) as Any? ?? NSNull(),
             "portalFrame": NavigationGeometryTestObservation.finiteRect(portal.frame)]
        }

        private static func publish(_ event: String, fields: [String: Any]) {
            guard let owner = fields["ownerID"] as? String,
                  let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]) else { return }
            let key = "\(event):\(owner)"
            guard last[key] != data else { return }
            last[key] = data
            TestLifecycleObservation.record(event, fields: fields)
        }
    }
#endif
