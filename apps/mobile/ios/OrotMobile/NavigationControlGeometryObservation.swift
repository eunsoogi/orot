#if OROT_TESTS
    import UIKit

    /// Opt-in scalar-only samples correlate known dock controls to their owning window and coordinate spaces.
    enum NavigationControlGeometryObservation {
        private static let identifiers: Set<String> = [
            "manual-history-save", "manual-history-form-close", "navigation-page-action-overflow", "navigation-back", "navigation-home", "symptom-form-cancel", "next-visit-review-save",
        ]

        @MainActor static func snapshot(identity: (NSObject) -> String) -> [String: Any] {
            let started = Date().timeIntervalSince1970 * 1000
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let visibleWindows = scenes.flatMap(\.windows).filter { !$0.isHidden && $0.alpha > 0.01 }
            let windows = visibleWindows.filter(\.isKeyWindow)
            guard windows.count == 1, let window = windows.first, let scene = window.windowScene else {
                return ["status": windows.count > 1 ? "ambiguous" : "unavailable", "visibleKeyWindowCount": windows.count, "sampleStartedAtMs": started, "sampleEndedAtMs": Date().timeIntervalSince1970 * 1000]
            }
            // Inspect all visible app windows so another window cannot hide a duplicate candidate.
            var pending = visibleWindows.flatMap(\.subviews), candidates: [UIControl] = []
            var visited = 0
            while visited < 2048, let view = pending.popLast() {
                visited += 1
                pending.append(contentsOf: view.subviews)
                if let control = view as? UIControl, let id = control.accessibilityIdentifier, identifiers.contains(id) {
                    candidates.append(control)
                }
            }
            let truncated = !pending.isEmpty
            let windowSceneFrame = window.convert(window.bounds, to: scene.coordinateSpace)
            let windowScreenFrame = window.convert(window.bounds, to: window.screen.coordinateSpace)
            var allFinite = finite(window.bounds) && finite(windowSceneFrame) && finite(windowScreenFrame)
            var allHosted = true
            let records = candidates.map { control -> [String: Any] in
                let id = control.accessibilityIdentifier ?? ""
                let native = control.convert(control.bounds, to: window)
                let axScreen = control.accessibilityFrame
                let axWindow = window.convert(axScreen, from: nil as UIWindow?)
                let sceneFrame = window.convert(native, to: scene.coordinateSpace)
                allFinite = allFinite && finite(native) && finite(axScreen) && finite(axWindow) && finite(sceneFrame)
                var ancestor: UIView? = control
                var hidden = false
                var depth = 0
                var host: UIView?
                var hostRole = "unavailable"
                while let current = ancestor, depth < 64 {
                    hidden = hidden || current.isHidden || current.alpha <= 0.01
                    if host == nil, let identifier = current.accessibilityIdentifier,
                       ["navigation-toolbar", "navigation-page-action-toolbar"].contains(identifier)
                    {
                        host = current
                        hostRole = identifier == "navigation-toolbar" ? "navigation" : "page"
                    }
                    if current === window {
                        break
                    }
                    ancestor = current.superview
                    depth += 1
                }
                allHosted = allHosted && host != nil && ancestor === window
                var record: [String: Any] = ["identifier": id, "controlID": identity(control), "windowID": control.window.map(identity) as Any? ?? NSNull(),
                                             "hostID": host.map(identity) as Any? ?? NSNull(), "hostRole": hostRole,
                                             "sameWindow": control.window === window, "hidden": hidden, "ancestorComplete": ancestor === window,
                                             "enabled": control.isEnabled, "isAccessibilityElement": control.isAccessibilityElement,
                                             "nativeFrameInWindow": NavigationGeometryTestObservation.finiteRect(native),
                                             "accessibilityFrameInScreen": NavigationGeometryTestObservation.finiteRect(axScreen),
                                             "accessibilityFrameInWindow": NavigationGeometryTestObservation.finiteRect(axWindow),
                                             "frameInScene": NavigationGeometryTestObservation.finiteRect(sceneFrame)]
                if NavigationRailMountTestObservation.enabled {
                    record["mountObservationControlID"] = NavigationRailMountTestObservation.identity(control)
                }
                if id == "symptom-form-cancel" || (id == "navigation-page-action-overflow" && UserDefaults.standard.string(forKey: "OROT_TEST_MENU_PRESENTATION") == "YES"), control.window === window {
                    // Observe the same public activation point without sending a touch or reading patient content.
                    let point = window.convert(control.accessibilityActivationPoint, from: nil as UIWindow?)
                    if point.x.isFinite, point.y.isFinite {
                        let hit = window.hitTest(point, with: nil)
                        record["activationInWindow"] = ["x": point.x, "y": point.y]
                        record["hitRole"] = hit === control ? "control" : hit?.isDescendant(of: control) == true ? "descendant" : hit == nil ? "none" : "other"
                        if id == "navigation-page-action-overflow", let hit {
                            record["hitID"] = identity(hit)
                            record["hitClass"] = String(describing: type(of: hit))
                        }
                    } else {
                        record["hitRole"] = "unavailable"
                    }
                }
                return record
            }
            let counts = Dictionary(grouping: candidates, by: { $0.accessibilityIdentifier ?? "" }).mapValues(\.count)
            let status = correlationStatus(windowCount: windows.count, counts: counts, truncated: truncated, allValid: allFinite && allHosted && candidates.allSatisfy { $0.window === window })
            let orientation: Any = if #available(iOS 16.0, *) {
                scene.effectiveGeometry.interfaceOrientation.rawValue
            } else {
                NSNull()
            }
            let appointmentPage: [String: Any] = if UserDefaults.standard.string(forKey: "OROT_E2E_PROBE") == "appointments" {
                AppointmentPageScrollObservation.snapshot(window: window, identity: identity)
            } else {
                ["status": "not-requested"]
            }
            return ["status": status, "visibleKeyWindowCount": windows.count, "truncated": truncated, "visited": visited,
                    "windowID": identity(window), "sceneID": identity(scene), "screenID": identity(window.screen),
                    "orientation": orientation,
                    "windowBounds": NavigationGeometryTestObservation.finiteRect(window.bounds),
                    // The app window's traits, not the test runner's, determine this text-size lower bound.
                    "bodyLineHeight": Double(UIFont.preferredFont(forTextStyle: .body, compatibleWith: window.traitCollection).lineHeight),
                    "contentSizeCategory": window.traitCollection.preferredContentSizeCategory.rawValue,
                    "windowFrameInScene": NavigationGeometryTestObservation.finiteRect(windowSceneFrame),
                    "windowFrameInScreen": NavigationGeometryTestObservation.finiteRect(windowScreenFrame),
                    "screenCoordinateSpace": "UIKit-screen-base", "sceneCoordinateSpace": "UIWindowScene.coordinateSpace",
                    "controls": records, "appointmentPage": appointmentPage,
                    "sampleStartedAtMs": started, "sampleEndedAtMs": Date().timeIntervalSince1970 * 1000]
        }

        private static func finite(_ rect: CGRect) -> Bool {
            [rect.minX, rect.minY, rect.width, rect.height].allSatisfy(\.isFinite)
        }

        /// Never correlate missing, duplicate, detached, or truncated candidates.
        static func correlationStatus(windowCount: Int, counts: [String: Int], truncated: Bool, allValid: Bool) -> String {
            if windowCount > 1 || counts.values.contains(where: { $0 > 1 }) {
                return "ambiguous"
            }
            let pageCount = ["manual-history-save", "manual-history-form-close", "navigation-page-action-overflow", "next-visit-review-save"].reduce(0) { $0 + (counts[$1] ?? 0) }
            guard windowCount == 1, !truncated, allValid, counts["navigation-home"] == 1, counts["navigation-back"] == 1, pageCount > 0 else { return "unavailable" }
            return "available"
        }
    }
#endif
