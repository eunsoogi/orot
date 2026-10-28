#if OROT_TESTS
    import UIKit

    /// Reads public window and root-view geometry independently of the React Native sensor event.
    enum NavigationGeometryTestObservation {
        /// Returns the active app window and root safe area without reading route or screen content.
        static func snapshot() -> [String: Any] {
            guard let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow),
                let rootView = window.rootViewController?.viewIfLoaded
            else {
                return ["status": "unavailable"]
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

            return [
                // Compare the actual window contract; a root or sensor may be smaller.
                "windowBounds": rect(window.bounds),
                "safeAreaInsets": insets(window.safeAreaInsets),
                "reservedRegionsSupported": regionsSupported,
                "reservedRegions": regions,
                "navigationControls": currentNavigationControls(in: window),
            ]
        }

        /// Samples current UIKit coordinates without forcing layout or reading labels and route content.
        /// Keep all matching visible controls so duplicate hosts remain observable rather than picking one.
        private static func currentNavigationControls(in window: UIWindow) -> [String: Any] {
            var remaining = [window as UIView]
            var visited = 0
            var controls: [[String: Any]] = []
            while !remaining.isEmpty, visited < 2048 {
                let view = remaining.removeLast()
                visited += 1
                guard !view.isHidden, view.alpha > 0.01 else { continue }
                remaining.append(contentsOf: view.subviews)
                guard view is NavigationRootGlassBar || view.accessibilityIdentifier == "navigation-toolbar" else { continue }
                let frame = view.convert(view.bounds, to: window)
                guard !frame.isEmpty, frame.intersects(window.bounds) else { continue }
                controls.append([
                    "identifier": view.accessibilityIdentifier ?? "",
                    "frame": rect(frame),
                ])
            }
            return ["frames": controls, "truncated": !remaining.isEmpty, "visited": visited]
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
