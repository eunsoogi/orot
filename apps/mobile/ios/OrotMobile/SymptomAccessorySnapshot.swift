#if OROT_TESTS
    import UIKit

    /// Sample the declared symptom input/accessory pair and selected lane geometry, never input content or a view hierarchy.
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
                    "geometry": geometry(input, views: visited, identity: identity),
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

        /// Compare the public RN accessibility getter with its component in one synchronous main-actor sample.
        /// Only selected structural rectangles are exported; unknown/ambiguous ancestors never become a guessed outer frame.
        private static func geometry(_ input: UITextView, views: [UIView], identity: (NSObject) -> String) -> [String: Any] {
            guard let window = input.window else { return ["status": "input-window-unavailable"] }
            var ancestor = input.superview
            var components: [UIView] = []
            var visited = 0
            while let current = ancestor, visited < 64 {
                if String(describing: type(of: current)) == "RCTTextInputComponentView" {
                    components.append(current)
                }
                ancestor = current.superview
                visited += 1
            }
            var result: [String: Any] = [
                "atMs": Date().timeIntervalSince1970 * 1000, "windowIdentity": identity(window),
                "input": geometryView(input, window: window, identity: identity),
                "outerComponentCount": components.count, "ancestorTraversalComplete": ancestor == nil,
                // Read effective UIKit traits and the rendered input font, not the requested launch arguments.
                "contentSizeCategory": window.traitCollection.preferredContentSizeCategory.rawValue,
                "isAccessibilityCategory": window.traitCollection.preferredContentSizeCategory.isAccessibilityCategory,
                "userInterfaceStyle": window.traitCollection.userInterfaceStyle.rawValue,
                "fontPointSize": input.font.map { Double($0.pointSize) } as Any? ?? NSNull(),
            ]
            for identifier in ["symptoms-scroll", "symptoms-form-lane"] {
                let matches = views.filter { $0.accessibilityIdentifier == identifier && $0.window === window }
                result[identifier] = ["count": matches.count, "views": matches.prefix(2).map { geometryView($0, window: window, identity: identity) }]
            }
            guard components.count == 1, ancestor == nil, let component = components.first else {
                result["status"] = "outer-component-unresolved"
                return result
            }
            // RCTViewComponentView.h declares this object-returning getter; no private ivar/KVC access is used.
            let selector = NSSelectorFromString("accessibilityElement")
            let exposed = component.responds(to: selector)
                ? component.perform(selector)?.takeUnretainedValue() as? UIView : nil
            result["outer"] = geometryView(component, window: window, identity: identity)
            result["accessibilityView"] = exposed.map { geometryView($0, window: window, identity: identity) } as Any? ?? NSNull()
            result["accessibilityViewIsInput"] = exposed.map { $0 === input } as Any? ?? NSNull()
            result["inputFrameInOuter"] = rectangle(input.convert(input.bounds, to: component)) as Any? ?? NSNull()
            result["status"] = exposed == nil ? "accessibility-view-unavailable" : "sampled"
            return result
        }

        private static func geometryView(_ view: UIView, window: UIWindow, identity: (NSObject) -> String) -> [String: Any] {
            let sameWindow = view.window === window
            return ["identity": identity(view), "class": String(describing: type(of: view)), "sameWindow": sameWindow,
                    "bounds": rectangle(view.bounds) as Any? ?? NSNull(),
                    "windowFrame": sameWindow ? (rectangle(view.convert(view.bounds, to: window)) as Any? ?? NSNull()) : NSNull()]
        }

        /// Transitional invalid geometry is missing evidence, not a JSON serialization failure or a normal rectangle.
        private static func rectangle(_ frame: CGRect) -> [String: Double]? {
            let values = ["x": Double(frame.minX), "y": Double(frame.minY), "width": Double(frame.width), "height": Double(frame.height)]
            return values.values.allSatisfy(\.isFinite) ? values : nil
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
