#if OROT_TESTS
    import UIKit

    /// Sample only the declared symptom input/accessory pair; never serialize input content or a view hierarchy.
    @MainActor
    enum SymptomAccessorySnapshot {
        static func capture(roots: [UIView], identity: (NSObject) -> String) -> [String: Any] {
            var pending = Array(roots.prefix(8))
            var visited: [UIView] = []
            while visited.count < 512, let view = pending.popLast() {
                visited.append(view)
                pending.append(contentsOf: view.subviews)
            }
            let inputs = visited.compactMap { $0 as? UITextView }.filter { $0.accessibilityIdentifier == "symptom-description" }
            let declaredIDs = Set(["symptom-form-description"] + inputs.compactMap { stringGetter($0, "inputAccessoryViewID") })
            let providers = visited.filter { view in
                stringGetter(view, "nativeId").map { declaredIDs.contains($0) } ?? false
            }
            let inputReports = inputs.prefix(4).map { input -> [String: Any] in
                let actual = input.inputAccessoryView
                return [
                    "input": viewReport(input, identity: identity),
                    "isFirstResponder": input.isFirstResponder,
                    "declaredAccessoryID": stringGetter(input, "inputAccessoryViewID") as Any? ?? NSNull(),
                    "actualAccessory": actual.map { viewReport($0, identity: identity) } as Any? ?? NSNull(),
                    "matchingProviders": providers.prefix(8).map { provider -> [String: Any] in
                        let content = provider.inputAccessoryView
                        let sharesActual = if let actual, let content {
                            (content === actual) as Any
                        } else {
                            NSNull() as Any
                        }
                        return [
                            "component": viewReport(provider, identity: identity),
                            "nativeId": stringGetter(provider, "nativeId") as Any? ?? NSNull(),
                            "getterAccessory": content.map { viewReport($0, identity: identity) } as Any? ?? NSNull(),
                            // Equal declared IDs, or two absent getters, do not establish an actual object attachment.
                            "sharesActualAccessory": sharesActual,
                        ]
                    },
                ]
            }
            return [
                "atMs": Date().timeIntervalSince1970 * 1000,
                "scope": "symptom-description", "inputs": inputReports,
                "inputCount": inputs.count, "providerCount": providers.count,
                "visited": visited.count, "truncated": !pending.isEmpty || roots.count > 8 || inputs.count > 4 || providers.count > 8,
                "providers": providers.prefix(8).map { provider in
                    ["component": viewReport(provider, identity: identity),
                     "nativeId": stringGetter(provider, "nativeId") as Any? ?? NSNull()] as [String: Any]
                },
            ]
        }

        /// These object-returning getters are declared by RN's public RCTViewComponentView/RCTUITextView headers.
        /// `perform` calls the confirmed getter only; no KVC fallback or private-ivar inspection is permitted.
        private static func stringGetter(_ view: UIView, _ name: String) -> String? {
            let selector = NSSelectorFromString(name)
            guard view.responds(to: selector) else { return nil }
            return view.perform(selector)?.takeUnretainedValue() as? String
        }

        private static func viewReport(_ view: UIView, identity: (NSObject) -> String) -> [String: Any] {
            var ancestor = view.superview
            var ancestorHidden = false
            var ancestorsVisited = 0
            while let current = ancestor, ancestorsVisited < 64 {
                ancestorHidden = ancestorHidden || current.isHidden || current.alpha <= 0
                ancestorsVisited += 1
                ancestor = current.superview
            }
            // Raw visibility flags do not establish absence of occlusion by another view.
            return ["identity": identity(view), "class": String(describing: type(of: view)),
                    "hasWindow": view.window != nil, "windowIdentity": view.window.map(identity) as Any? ?? NSNull(),
                    "hidden": view.isHidden, "alpha": view.alpha, "ancestorHidden": ancestorHidden,
                    "visibilityTraversalComplete": ancestor == nil,
                    "windowHidden": view.window.map(\.isHidden) as Any? ?? NSNull()]
        }
    }
#endif
