#if OROT_TESTS
    import UIKit

    /// Reads public window and root-view geometry independently of the React Native sensor event.
    enum NavigationGeometryTestObservation {
        /// Returns the active app window and root safe area without reading route or screen content.
        static func snapshot(identity: ((NSObject) -> String)? = nil) -> [String: Any] {
            precondition(Thread.isMainThread)
            guard let identity else { return geometrySnapshot(identity: nil) }
            // A nil focus does not imply VoiceOver is disabled. Sample the app-side public flag separately.
            let running = UIAccessibility.isVoiceOverRunning
            let readAtMs = Date().timeIntervalSince1970 * 1000
            var result = geometrySnapshot(identity: identity)
            result["appVoiceOver"] = voiceOverState(running: running, readAtMs: readAtMs)
            return result
        }

        /// A fixed metadata schema prevents the diagnostic channel from accepting focused content.
        static func voiceOverState(running: Bool, readAtMs: Double) -> [String: Any] {
            ["running": running, "readAtMs": readAtMs.isFinite ? readAtMs as Any : NSNull(), "timestampUnits": "unix-milliseconds"]
        }

        private static func geometrySnapshot(identity: ((NSObject) -> String)?) -> [String: Any] {
            let started = Date().timeIntervalSince1970 * 1000
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            let visibleKeys = windows.filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0.01 }
            if identity != nil, visibleKeys.count != 1 {
                return ["homeFocus": ["status": visibleKeys.isEmpty ? "unavailable" : "ambiguous",
                                      "visibleKeyWindowCount": visibleKeys.count, "homeCount": NSNull(),
                                      "traversal": "not-performed", "truncated": false, "coordinateUnits": "points"],
                        "sampleStartedAtMs": started, "sampleEndedAtMs": Date().timeIntervalSince1970 * 1000, "timestampUnits": "unix-milliseconds"]
            }
            guard let window = identity != nil ? visibleKeys.first : windows.first(where: \.isKeyWindow),
                  let rootView = window.rootViewController?.viewIfLoaded
            else {
                guard identity != nil else { return ["status": "unavailable"] }
                return ["homeFocus": ["status": "unavailable", "visibleKeyWindowCount": visibleKeys.count,
                                      "homeCount": NSNull(), "traversal": "not-performed", "truncated": false, "coordinateUnits": "points"],
                        "sampleStartedAtMs": started, "sampleEndedAtMs": Date().timeIntervalSince1970 * 1000, "timestampUnits": "unix-milliseconds"]
            }

            var regions: [[String: Any]] = []
            var regionsSupported = false
            if #available(iOS 27.1, *) {
                regionsSupported = true
                regions += serialize(
                    rootView.reservedRegions(kind: .division, options: .includeInactive),
                    kind: "division",
                    view: rootView,
                    window: window,
                )
                regions += serialize(
                    rootView.reservedRegions(kind: .occlusion, options: .includeInactive),
                    kind: "occlusion",
                    view: rootView,
                    window: window,
                )
            }

            let controls = currentNavigationControls(in: window, windows: visibleKeys, identity: identity)
            let ended = Date().timeIntervalSince1970 * 1000
            return [
                // Compare the actual window contract; a root or sensor may be smaller.
                "windowBounds": rect(window.bounds),
                "safeAreaInsets": insets(window.safeAreaInsets),
                "reservedRegionsSupported": regionsSupported,
                "reservedRegions": regions,
                "navigationControls": controls,
                "sampleStartedAtMs": started, "sampleEndedAtMs": ended, "timestampUnits": "unix-milliseconds",
            ]
        }

        /// Samples current UIKit coordinates without forcing layout or reading labels and route content.
        /// Keep all matching visible controls so duplicate hosts remain observable rather than picking one.
        private static func currentNavigationControls(in window: UIWindow, windows: [UIWindow], identity: ((NSObject) -> String)?) -> [String: Any] {
            var remaining = [window as UIView]
            var visited = 0
            var controls: [[String: Any]] = []
            var homes: [UIControl] = []
            var navigation: [UIView] = []
            while !remaining.isEmpty, visited < 2048 {
                let view = remaining.removeLast()
                visited += 1
                guard !view.isHidden, view.alpha > 0.01 else { continue }
                remaining.append(contentsOf: view.subviews)
                let isHost = view is NavigationRootGlassBar || view.accessibilityIdentifier == "navigation-toolbar"
                // Keep the original non-opted-in path from converting every descendant's frame.
                guard identity != nil || isHost else { continue }
                let frame = view.convert(view.bounds, to: window)
                guard !frame.isEmpty, frame.intersects(window.bounds) else { continue }
                if identity != nil, let control = view as? UIControl,
                   ["navigation-tab-home", "navigation-tab-records", "navigation-tab-schedule", "navigation-tab-ai", "navigation-tab-settings", "navigation-back", "navigation-home"].contains(control.accessibilityIdentifier ?? "")
                {
                    navigation.append(control)
                    if control.accessibilityIdentifier == "navigation-tab-home" {
                        homes.append(control)
                    }
                }
                guard isHost else { continue }
                controls.append([
                    "identifier": view.accessibilityIdentifier ?? "",
                    "frame": rect(frame),
                ])
            }
            var result: [String: Any] = ["frames": controls, "truncated": !remaining.isEmpty, "visited": visited]
            if let identity {
                // One public read only on the opted-in test path; no label, value or identifier is read from focus.
                let focused = UIAccessibility.focusedElement(using: .notificationVoiceOver) as? NSObject
                result["homeFocus"] = focusObservation(windows: windows, homes: homes, navigation: navigation,
                                                       truncated: !remaining.isEmpty, focused: focused, identity: identity)
            }
            return result
        }

        /// Missing/duplicate candidates and incomplete traversal never produce a correlated Home/window payload.
        static func focusObservation(windows: [UIWindow], homes: [UIControl], navigation: [UIView], truncated: Bool,
                                     focused: NSObject?, identity: (NSObject) -> String) -> [String: Any]
        {
            var result: [String: Any] = ["visibleKeyWindowCount": windows.count, "homeCount": homes.count,
                                         "truncated": truncated, "coordinateUnits": "points", "timestampUnits": "unix-milliseconds"]
            guard windows.count == 1, homes.count == 1, !truncated else {
                result["status"] = windows.count > 1 || homes.count > 1 ? "ambiguous" : "unavailable"
                return result
            }
            let window = windows[0], home = homes[0]
            guard home.window === window else { result["status"] = "unavailable"; return result }
            let axFrame = home.accessibilityFrame
            let activation = home.accessibilityActivationPoint
            result["status"] = "available"
            result["homeID"] = identity(home)
            result["windowID"] = identity(window)
            result["windowBounds"] = finiteRect(window.bounds)
            result["orientation"] = window.windowScene?.effectiveGeometry.interfaceOrientation.rawValue ?? 0
            // UIKit's nil source window denotes screen base coordinates; no inferred rotation is applied.
            result["screenCoordinateSpace"] = "UIKit-screen-base"
            result["nativeFrameInWindow"] = finiteRect(home.convert(home.bounds, to: window))
            result["accessibilityFrameInScreen"] = finiteRect(axFrame)
            result["accessibilityFrameInWindow"] = finiteRect(window.convert(axFrame, from: nil as UIWindow?))
            result["activationPointInScreen"] = finitePoint(activation)
            result["activationPointInWindow"] = finitePoint(window.convert(activation, from: nil as UIWindow?))
            result["traits"] = home.accessibilityTraits.rawValue
            result["selected"] = home.isSelected
            result["enabled"] = home.isEnabled
            result["isAccessibilityElement"] = home.isAccessibilityElement
            result["focusedRole"] = focused == nil ? "unavailable" : focused === home ? "home" : navigation.contains { $0 === focused } ? "known-navigation" : "opaque"
            result["focusedID"] = focused.map(identity) ?? NSNull() as Any
            return result
        }

        /// JSON cannot encode NaN or infinity; retain the missing coordinate explicitly instead of losing the whole marker.
        static func finiteRect(_ value: CGRect) -> [String: Any] {
            ["x": finite(value.origin.x), "y": finite(value.origin.y), "width": finite(value.width), "height": finite(value.height)]
        }

        private static func finitePoint(_ value: CGPoint) -> [String: Any] {
            ["x": finite(value.x), "y": finite(value.y)]
        }

        private static func finite(_ value: CGFloat) -> Any {
            value.isFinite ? Double(value) : NSNull()
        }

        @available(iOS 27.1, *)
        private static func serialize(
            _ regions: [UIView.ReservedRegion],
            kind: String,
            view: UIView,
            window: UIWindow,
        ) -> [[String: Any]] {
            regions.map { region in
                [
                    "id": String(describing: region.id),
                    "kind": kind,
                    "frame": rect(window.convert(region.frame, from: view)),
                    "margins": insets(region.margins),
                    "isActive": region.isActive,
                ]
            }
        }

        private static func rect(_ value: CGRect) -> [String: Double] {
            [
                "x": Double(value.minX),
                "y": Double(value.minY),
                "width": Double(value.width),
                "height": Double(value.height),
            ]
        }

        private static func insets(_ value: UIEdgeInsets) -> [String: Double] {
            [
                "top": Double(value.top),
                "right": Double(value.right),
                "bottom": Double(value.bottom),
                "left": Double(value.left),
            ]
        }
    }
#endif
