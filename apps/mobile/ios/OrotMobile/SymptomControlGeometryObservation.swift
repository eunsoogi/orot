#if OROT_TESTS
    import UIKit

    /// Samples fixed symptom controls without input contents or arbitrary accessibility identifiers.
    @MainActor
    enum SymptomControlGeometryObservation {
        private static let roles = ["symptom-description", "symptom-onset-date", "symptom-onset-time", "symptom-status-active", "symptom-save", "symptom-form-cancel", "navigation-back", "navigation-home"]

        static func capture(input: UITextView, views: [UIView], window: UIWindow, truncated: Bool, identity: (NSObject) -> String) -> [String: Any] {
            let started = Date().timeIntervalSince1970 * 1000
            let known = Dictionary(uniqueKeysWithValues: roles.map { role in (role, views.filter { $0.accessibilityIdentifier == role }) })
            let inputChain = ancestors(input)
            let inputScrolls = inputChain.views.compactMap { $0 as? UIScrollView }
            let selectionComplete = !truncated && inputChain.complete && inputChain.views.contains { $0 === window } && input.window === window
            let selected = selectionComplete && inputScrolls.count == 1 ? inputScrolls.first : nil
            let focused = views.filter { $0.isFirstResponder && $0.window === window }
            let otherWindowFocusCount = views.filter { $0.isFirstResponder && $0.window !== window }.count
            let focusRole = focused.count == 1 ? (roles.first { (known[$0] ?? []).contains(focused[0]) } ?? "other") : focused.isEmpty ? "none" : "ambiguous"
            var result: [String: Any] = ["startedAtMs": started, "windowID": identity(window), "truncated": truncated, "focusCount": focused.count, "otherWindowFocusCount": otherWindowFocusCount, "focusScope": "visited-views-in-window", "focusRole": truncated ? "unknown" : focusRole, "selectionComplete": selectionComplete]
            var controls: [[String: Any]] = []
            for role in roles.prefix(4) {
                let candidates = known[role] ?? []
                controls.append(["role": role, "count": candidates.count, "truncated": candidates.count > 4, "candidates": candidates.prefix(4).map { control in
                    candidate(control, role: role, known: known, selected: selected, window: window, identity: identity)
                }])
            }
            result["controls"] = controls
            if let selected {
                let inset = selected.adjustedContentInset, contentInset = selected.contentInset
                result["scroll"] = ["id": identity(selected), "bounds": rect(selected.bounds), "offset": point(selected.contentOffset), "size": ["width": finite(selected.contentSize.width), "height": finite(selected.contentSize.height)], "adjustedInset": insets(inset), "contentInset": insets(contentInset), "tracking": selected.isTracking, "dragging": selected.isDragging, "decelerating": selected.isDecelerating]
            }
            result["selectedScrollCount"] = inputScrolls.count
            result["endedAtMs"] = Date().timeIntervalSince1970 * 1000
            return result
        }

        private static func candidate(_ control: UIView, role _: String, known: [String: [UIView]], selected: UIScrollView?, window: UIWindow, identity: (NSObject) -> String) -> [String: Any] {
            let chain = ancestors(control)
            let scroll = chain.views.compactMap { $0 as? UIScrollView }.first
            let sameWindow = control.window === window
            let frame = sameWindow ? control.convert(control.bounds, to: window) : .null
            var clip = frame.intersection(window.bounds)
            var complete = chain.complete && chain.views.contains { $0 === window } && control.window === window && finiteFrame(frame)
            for view in [control] + chain.views {
                complete = complete && view.layer.mask == nil && view.transform.isIdentity && CATransform3DIsIdentity(view.layer.transform) && (view === window || view.window === window) && finiteFrame(view.convert(view.bounds, to: window))
                if view.clipsToBounds || view.layer.masksToBounds {
                    clip = clip.intersection(view.convert(view.bounds, to: window))
                }
            }
            let activation = sameWindow ? window.convert(control.accessibilityActivationPoint, from: nil as UIWindow?) : .zero
            var result: [String: Any] = ["id": identity(control), "windowID": control.window.map(identity) ?? "unavailable", "firstResponder": control.isFirstResponder, "hidden": control.isHidden, "alpha": control.alpha, "ancestorHidden": chain.views.contains { $0.isHidden || $0.alpha <= 0 }]
            result["frame"] = sameWindow ? rect(frame) as Any : NSNull()
            result["nearestScrollID"] = scroll.map(identity) ?? "unavailable"
            result["sameSelectedScroll"] = selected.flatMap { chosen in scroll.map { $0 === chosen } } as Any? ?? NSNull()
            result["clippingComplete"] = complete
            result["clippedFrame"] = complete ? rect(clip) as Any : NSNull()
            result["clippedFrameEmpty"] = complete ? (clip.isNull || clip.isEmpty) as Any : NSNull()
            result["centerHit"] = sameWindow ? hit(window, point: CGPoint(x: frame.midX, y: frame.midY), known: known, selected: selected, identity: identity) : ["status": "unavailable"]
            result["activationHit"] = sameWindow ? hit(window, point: activation, known: known, selected: selected, identity: identity) : ["status": "unavailable"]
            return result
        }

        private static func hit(_ window: UIWindow, point: CGPoint, known: [String: [UIView]], selected: UIScrollView?, identity: (NSObject) -> String) -> [String: Any] {
            guard point.x.isFinite, point.y.isFinite, let view = window.hitTest(point, with: nil) else { return ["status": "unavailable"] }
            var cursor: UIView? = view
            while let candidate = cursor {
                if let role = roles.first(where: { (known[$0] ?? []).contains(candidate) }) {
                    return ["role": role, "id": identity(view), "point": Self.point(point), "units": "window-points"]
                }
                if candidate === selected {
                    return ["role": "selected-scroll", "id": identity(view), "point": Self.point(point), "units": "window-points"]
                }
                cursor = candidate.superview
            }
            return ["role": "other", "id": identity(view), "point": Self.point(point), "units": "window-points"]
        }

        private static func ancestors(_ view: UIView) -> (views: [UIView], complete: Bool) {
            var result: [UIView] = [], current = view.superview
            while let value = current, result.count < 64 {
                result.append(value)
                current = value.superview
            }
            return (result, current == nil)
        }

        private static func rect(_ value: CGRect) -> [String: Any] {
            NavigationGeometryTestObservation.finiteRect(value)
        }

        private static func finiteFrame(_ value: CGRect) -> Bool {
            [value.minX, value.minY, value.width, value.height].allSatisfy(\.isFinite)
        }

        private static func point(_ value: CGPoint) -> [String: Any] {
            ["x": value.x.isFinite ? value.x as Any : NSNull(), "y": value.y.isFinite ? value.y as Any : NSNull()]
        }

        private static func insets(_ value: UIEdgeInsets) -> [String: Any] {
            ["top": finite(value.top), "right": finite(value.right), "bottom": finite(value.bottom), "left": finite(value.left)]
        }

        private static func finite(_ value: CGFloat) -> Any {
            value.isFinite ? value as Any : NSNull()
        }
    }
#endif
