#if OROT_TESTS
    import UIKit

    /// Capture every control in the two active dock hosts, including disabled controls.
    @MainActor
    enum SymptomDockControlObservation {
        static func capture(views: [UIView], window: UIWindow, truncated: Bool, identity: (NSObject) -> String) -> [String: Any] {
            let identifiers = ["navigation-page-action-toolbar", "navigation-toolbar"]
            let knownRoles = ["symptom-save", "symptom-form-cancel", "navigation-page-action-overflow", "navigation-back", "navigation-home"]
            var controls: [[String: Any]] = []
            var complete = !truncated
            var seen = Set<ObjectIdentifier>()
            var knownCounts: [String: Int] = [:]
            // A bounded walk must establish ancestry even for controls not ultimately belonging to either host.
            complete = complete && views.filter { $0 is UIControl && $0.window === window }.allSatisfy { chainToWindow($0, window: window).complete }
            for identifier in identifiers {
                let hosts = views.filter { $0.accessibilityIdentifier == identifier && active($0, window: window) }
                guard hosts.count == 1, let host = hosts.first else { complete = false; continue }
                let descendants = views.filter { $0 is UIControl && belongs($0, to: host) }
                for control in descendants {
                    guard seen.insert(ObjectIdentifier(control)).inserted else { complete = false; continue }
                    let chain = chainToWindow(control, window: window)
                    let value = control.convert(control.bounds, to: window)
                    var clipped = value.intersection(window.bounds)
                    for ancestor in chain.views where ancestor.clipsToBounds || ancestor.layer.masksToBounds {
                        clipped = clipped.intersection(ancestor.convert(ancestor.bounds, to: window))
                    }
                    guard control.window === window, chain.complete, chain.views.contains(where: { $0 === host }),
                          chain.views.allSatisfy({ $0.layer.mask == nil && $0.transform.isIdentity && CATransform3DIsIdentity($0.layer.transform) }),
                          valid(value), valid(clipped), window.bounds.contains(value) else { complete = false; continue }
                    if let id = control.accessibilityIdentifier, knownRoles.contains(id) {
                        knownCounts[id, default: 0] += 1
                    }
                    controls.append(["id": identity(control), "frame": NavigationGeometryTestObservation.finiteRect(value)])
                }
            }
            for role in knownRoles {
                let candidates = views.filter { $0 is UIControl && $0.accessibilityIdentifier == role }
                complete = complete && candidates.count <= 1 && candidates.allSatisfy { seen.contains(ObjectIdentifier($0)) && $0.window === window }
            }
            complete = complete && knownCounts.values.allSatisfy { $0 == 1 }
            return ["complete": complete, "windowID": identity(window), "controls": controls]
        }

        private static func active(_ view: UIView, window: UIWindow) -> Bool {
            let chain = chainToWindow(view, window: window)
            return chain.complete && view.window === window && ([view] + chain.views).allSatisfy { !$0.isHidden && $0.alpha > 0 }
        }

        private static func belongs(_ view: UIView, to host: UIView) -> Bool {
            var current = view.superview, depth = 0
            while let item = current, depth < 64 {
                if item === host {
                    return true
                }
                current = item.superview
                depth += 1
            }
            return false
        }

        private static func chainToWindow(_ view: UIView, window: UIWindow) -> (views: [UIView], complete: Bool) {
            var current = view.superview, result: [UIView] = []
            while let item = current, result.count < 64 {
                result.append(item)
                if item === window {
                    return (result, true)
                }
                current = item.superview
            }
            return (result, false)
        }

        private static func valid(_ rect: CGRect) -> Bool {
            !rect.isNull && !rect.isInfinite && rect.width > 0 && rect.height > 0 &&
                [rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy(\.isFinite)
        }
    }
#endif
