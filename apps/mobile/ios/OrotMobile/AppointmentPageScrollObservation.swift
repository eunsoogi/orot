#if OROT_TESTS
    import UIKit

    /// Samples only the fixed appointment page's physical scroll ownership, never its content.
    @MainActor enum AppointmentPageScrollObservation {
        static func snapshot(window: UIWindow, identity: (NSObject) -> String) -> [String: Any] {
            let keys = ["appointments-scroll", "appointments-columns-primary", "appointments-columns-secondary"]
            var pending: [UIView] = [window], matches: [String: [UIView]] = [:], visited = 0
            while visited < 2048, let view = pending.popLast() {
                visited += 1
                pending.append(contentsOf: view.subviews)
                if let id = view.accessibilityIdentifier, keys.contains(id) {
                    matches[id, default: []].append(view)
                }
            }
            let counts = keys.map { matches[$0]?.count ?? 0 }
            guard pending.isEmpty, counts == [1, 1, 1],
                  let wrapper = matches[keys[0]]?.first, let primary = matches[keys[1]]?.first,
                  let secondary = matches[keys[2]]?.first, wrapper.window === window,
                  primary.window === window, secondary.window === window
            else {
                return ["status": "unavailable", "counts": counts, "truncated": !pending.isEmpty, "visited": visited]
            }
            // Fabric wraps the page UIScrollView; also support a root that is itself the scroll view.
            let owners = (wrapper as? UIScrollView).map { [$0] } ?? wrapper.subviews.compactMap { $0 as? UIScrollView }
            guard owners.count == 1, let owner = owners.first else {
                return ["status": "unavailable", "counts": counts, "ownerCount": owners.count, "truncated": false]
            }
            func ancestors(_ panel: UIView) -> (ids: [String], complete: Bool) {
                var current: UIView? = panel, ids: [String] = [], depth = 0
                while let view = current, depth < 64 {
                    if let scroll = view as? UIScrollView {
                        ids.append(identity(scroll))
                    }
                    if view === wrapper {
                        return (ids, true)
                    }
                    current = view.superview; depth += 1
                }
                return (ids, false)
            }
            func sectionScrollCount(_ panel: UIView) -> (count: Int, complete: Bool) {
                var stack = panel.subviews, count = 0, visited = 0
                while visited < 2048, let view = stack.popLast() {
                    visited += 1
                    if view is UIScrollView {
                        count += 1
                    }
                    stack.append(contentsOf: view.subviews)
                }
                return (count, stack.isEmpty)
            }
            let first = ancestors(primary), second = ancestors(secondary)
            let firstNested = sectionScrollCount(primary), secondNested = sectionScrollCount(secondary)
            let ownerID = identity(owner)
            func frame(_ view: UIView) -> [String: Any] {
                NavigationGeometryTestObservation.finiteRect(view.convert(view.bounds, to: window.screen.coordinateSpace))
            }
            return ["status": "sampled", "windowID": identity(window), "wrapperID": identity(wrapper), "ownerID": ownerID,
                    "primaryID": identity(primary), "secondaryID": identity(secondary), "counts": counts, "ownerCount": owners.count,
                    "primaryAncestors": first.ids, "secondaryAncestors": second.ids,
                    "primaryComplete": first.complete && firstNested.complete, "secondaryComplete": second.complete && secondNested.complete,
                    "primaryNested": firstNested.count, "secondaryNested": secondNested.count, "truncated": false,
                    "ownerEnabled": owner.isScrollEnabled,
                    "ownerContentSize": ["width": owner.contentSize.width, "height": owner.contentSize.height],
                    "ownerOffset": ["x": owner.contentOffset.x, "y": owner.contentOffset.y],
                    "wrapperFrame": frame(wrapper), "ownerFrame": frame(owner), "primaryFrame": frame(primary), "secondaryFrame": frame(secondary)]
        }
    }
#endif
