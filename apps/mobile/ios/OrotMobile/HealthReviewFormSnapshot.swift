#if OROT_TESTS
    import UIKit

    /// An observer can fail without suppressing or repeating the original event dispatch.
    enum FormObservationDispatch {
        static func around<T>(before: (() throws -> Void)?, after: (() throws -> Void)?, dispatch: () throws -> T) rethrows -> T {
            _ = try? before?()
            defer { _ = try? after?() }
            return try dispatch()
        }
    }

    /// Only fixed roles and numeric geometry cross the writer boundary; no UIKit objects or screen content escape.
    struct HealthReviewFormSnapshot: Codable, Sendable {
        enum Role: String, Codable, Sendable { case control, textInput, scroll, other }
        enum Owner: String, Codable, Sendable { case start, focus, receiver }
        struct Region: Codable, Sendable {
            let role: Role
            let frame: [Double]
        }

        struct Scroll: Codable, Sendable {
            let owner: Owner
            let ancestor: Int
            let frame: [Double]
            let bounds: [Double]
            let offset: [Double]
            let extent: [Double]
            let inset: [Double]
            let adjustedInset: [Double]
            let dragging: Bool
            let decelerating: Bool
        }

        let start: Region?
        let focusedInput: Region?
        let receiver: Region?
        let scrolls: [Scroll]
        let truncated: Bool
        let startMatches: Int
        let focusMatches: Int

        /// Traverse at most 512 existing views, never force layout or read a text/accessibility value.
        @MainActor static func capture(in window: UIWindow, receiver: UIView?) -> Self? {
            var pending = window.subviews
            var views: [UIView] = []
            while views.count < 512, let view = pending.popLast() {
                views.append(view)
                pending.append(contentsOf: view.subviews)
            }
            let forms = views.filter { $0.accessibilityIdentifier == "health-review-screen" }
            guard forms.count == 1, let form = forms.first else { return nil }
            let starts = views.filter { $0.accessibilityIdentifier == "health-review-start" && $0.isDescendant(of: form) }
            let focused = views.filter { $0.isFirstResponder && $0.isDescendant(of: form) }
            let start = starts.count == 1 ? starts.first : nil
            let focus = focused.count == 1 ? focused.first : nil
            // A system keyboard window is outside this sink. Never substitute a fresh hitTest for UITouch.view.
            let actualReceiver = receiver.flatMap { $0.isDescendant(of: form) ? $0 : nil }
            guard actualReceiver != nil else { return nil }
            let owners: [(Owner, UIView?)] = [(.start, start), (.focus, focus), (.receiver, actualReceiver)]
            var scrolls: [Scroll] = []
            var truncated = !pending.isEmpty
            for (owner, view) in owners {
                var ancestor = view
                var depth = 0
                while let current = ancestor, depth < 32 {
                    if let scroll = current as? UIScrollView {
                        scrolls.append(Scroll(owner: owner, ancestor: depth, frame: frame(scroll, in: window),
                                              bounds: rect(scroll.bounds), offset: point(scroll.contentOffset),
                                              extent: [Double(scroll.contentSize.width), Double(scroll.contentSize.height)],
                                              inset: insets(scroll.contentInset), adjustedInset: insets(scroll.adjustedContentInset),
                                              dragging: scroll.isDragging, decelerating: scroll.isDecelerating))
                    }
                    ancestor = current.superview
                    depth += 1
                }
                truncated = truncated || ancestor != nil
            }
            return Self(start: start.map { Region(role: .control, frame: frame($0, in: window)) },
                        focusedInput: focus.map { region($0, in: window) }, receiver: actualReceiver.map { region($0, in: window) },
                        scrolls: scrolls, truncated: truncated, startMatches: starts.count, focusMatches: focused.count)
        }

        @MainActor private static func region(_ view: UIView, in window: UIWindow) -> Region {
            let role: Role = view is UITextField || view is UITextView ? .textInput : (view is UIScrollView ? .scroll : .other)
            return Region(role: role, frame: frame(view, in: window))
        }

        /// Screen points match XCTest frames; offsets, extents and insets remain the scroll view's local points.
        @MainActor private static func frame(_ view: UIView, in window: UIWindow) -> [Double] {
            rect(window.convert(view.convert(view.bounds, to: window), to: window.screen.coordinateSpace))
        }

        static func rect(_ value: CGRect) -> [Double] {
            [Double(value.origin.x), Double(value.origin.y), Double(value.size.width), Double(value.size.height)]
        }

        static func point(_ value: CGPoint) -> [Double] {
            [Double(value.x), Double(value.y)]
        }

        private static func insets(_ value: UIEdgeInsets) -> [Double] {
            [Double(value.top), Double(value.left), Double(value.bottom), Double(value.right)]
        }
    }
#endif
