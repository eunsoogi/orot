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
                "windowBounds": rect(window.convert(rootView.bounds, from: rootView)),
                "safeAreaInsets": insets(rootView.safeAreaInsets),
                "reservedRegionsSupported": regionsSupported,
                "reservedRegions": regions,
            ]
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
