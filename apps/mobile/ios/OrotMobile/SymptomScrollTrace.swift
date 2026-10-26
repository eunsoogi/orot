#if OROT_TESTS
    import UIKit

    /// Passive test-only targets observe the symptom scroller without changing gesture permission or exposing input content.
    @MainActor
    final class SymptomScrollTrace: NSObject {
        private weak var scroll: UIScrollView?
        private weak var taggedView: UIView?
        private let identities = NSMapTable<NSObject, NSString>(keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory)
        private var sequence = 0
        private let traceID = UUID().uuidString
        private let keyboardNames = [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardDidChangeFrameNotification]
        private var selection: [String: Any] = ["reason": "not-refreshed", "attached": false]
        private var traceEvents: [[String: Any]] = []
        private var recordedCount = 0
        private var descriptionAccessory: [String: Any] = ["status": "not-refreshed"]

        /// Selection and a separate 64-event history remain observable when RN events evict the shared lifecycle ring.
        func snapshot() -> [String: Any] {
            ["traceID": traceID, "selection": selection, "events": traceEvents, "capacity": 64,
             "recordedCount": recordedCount, "droppedCount": recordedCount - traceEvents.count,
             "descriptionAccessory": descriptionAccessory,
             "atMs": Date().timeIntervalSince1970 * 1000]
        }

        func refresh(windows: [UIWindow]) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_NAVIGATION_OBSERVATION") == "YES" else {
                descriptionAccessory = ["status": "not-opted-in"]
                stop()
                selection = ["reason": "not-opted-in", "attached": false]
                return
            }
            descriptionAccessory = SymptomAccessorySnapshot.capture(roots: windows, identity: identity)
            let keyWindows = windows.filter(\.isKeyWindow)
            let eligibleWindows = keyWindows.filter { !$0.isHidden && $0.alpha > 0 }
            selection = ["reason": "discovering", "attached": false, "atMs": Date().timeIntervalSince1970 * 1000,
                         "keyWindowCount": keyWindows.count,
                         "eligibleRootCount": eligibleWindows.count,
                         "tagCount": NSNull(), "outerScrollCount": NSNull(), "census": discoveryCensus(windows)]
            // UIWindow.window may be nil; start below it and retain window-membership checks for descendants.
            let tagged = eligibleWindows.flatMap { $0.subviews.flatMap(findTaggedViews) }
            selection["tagCount"] = tagged.count
            guard tagged.count == 1, let root = tagged.first else {
                stop()
                selection["reason"] = tagged.isEmpty ? "tag-unavailable" : "tag-ambiguous"
                return
            }
            // Stop at the outer scroller so a multiline editor's internal UIScrollView is never selected instead.
            let candidates = outerScrollViews(root)
            selection["outerScrollCount"] = candidates.count
            guard candidates.count == 1, let candidate = candidates.first else {
                stop()
                selection["reason"] = candidates.isEmpty ? "scroll-unavailable" : "scroll-ambiguous"
                return
            }
            selection["reason"] = "attached"
            selection["attached"] = true
            selection["scrollViewID"] = identity(candidate)
            selection["panID"] = identity(candidate.panGestureRecognizer)
            guard scroll !== candidate || taggedView !== root else { return }
            stop()
            scroll = candidate
            taggedView = root
            candidate.panGestureRecognizer.addTarget(self, action: #selector(observePan(_:)))
            for name in keyboardNames {
                NotificationCenter.default.addObserver(self, selector: #selector(observeKeyboard(_:)), name: name, object: nil)
            }
            selection["reason"] = "attached"
            selection["attached"] = true
            record("symptom-native-scroll-trace", fields: [
                "phase": "attached", "traceID": traceID, "scope": "symptoms-scroll",
                "scrollViewID": identity(candidate), "panID": identity(candidate.panGestureRecognizer),
                "scrollGeometry": geometry(candidate),
            ])
        }

        /// Bridge invalidation and removal of the tagged route both detach the exact target and notification observers.
        func stop() {
            if let scroll {
                scroll.panGestureRecognizer.removeTarget(self, action: #selector(observePan(_:)))
                record("symptom-native-scroll-trace", fields: [
                    "phase": "detached", "traceID": traceID, "scrollViewID": identity(scroll),
                ])
            }
            for name in keyboardNames {
                NotificationCenter.default.removeObserver(self, name: name, object: nil)
            }
            scroll = nil
            taggedView = nil
            selection["attached"] = false
            selection["reason"] = "detached"
        }

        /// Census includes nil-window roots; bounded visits and exact IDs expose predicates without exporting a hierarchy.
        private func discoveryCensus(_ windows: [UIWindow]) -> [String: Any] {
            let foreground = windows.filter { $0.windowScene?.activationState == .foregroundActive || $0.windowScene?.activationState == .foregroundInactive }
            let reports = foreground.prefix(8).map { window -> [String: Any] in
                let scan = boundedViews([window], limit: 512)
                let matches = scan.views.filter { ["symptoms-scroll", "symptoms-title"].contains($0.accessibilityIdentifier ?? "") }
                let matchReports = matches.prefix(8).map { view -> [String: Any] in
                    let ancestors = boundedViews(view.superview.map { [$0] } ?? [], ancestors: true, limit: 32)
                    let descendants = boundedViews(view.subviews, limit: 128)
                    return ["identifier": view.accessibilityIdentifier ?? "", "class": String(describing: type(of: view)),
                            "hidden": view.isHidden, "alpha": view.alpha, "hasWindow": view.window != nil, "isScrollView": view is UIScrollView,
                            "ancestorScrollCount": ancestors.views.filter { $0 is UIScrollView }.count,
                            "ancestorVisited": ancestors.views.count, "ancestorTruncated": ancestors.truncated,
                            "descendantScrollCount": descendants.views.filter { $0 is UIScrollView }.count,
                            "descendantVisited": descendants.views.count, "descendantTruncated": descendants.truncated]
                }
                return ["key": window.isKeyWindow, "hidden": window.isHidden, "alpha": window.alpha,
                        "hasWindow": window.window != nil, "windowIsSelf": window.window === window,
                        "visited": scan.views.count, "truncated": scan.truncated,
                        "matchCount": matches.count, "matchesTruncated": matches.count > 8, "matches": matchReports]
            }
            return ["foregroundWindowCount": foreground.count, "windowsTruncated": foreground.count > 8, "windows": reports]
        }

        private func boundedViews(_ roots: [UIView], ancestors: Bool = false, limit: Int) -> (views: [UIView], truncated: Bool) {
            var pending = roots
            var visited: [UIView] = []
            while visited.count < limit, let view = pending.popLast() {
                visited.append(view)
                pending.append(contentsOf: ancestors ? view.superview.map { [$0] } ?? [] : view.subviews)
            }
            return (visited, !pending.isEmpty)
        }

        private func findTaggedViews(_ view: UIView) -> [UIView] {
            guard !view.isHidden, view.alpha > 0, view.window != nil else { return [] }
            if view.accessibilityIdentifier == "symptoms-scroll" {
                return [view]
            }
            return view.subviews.flatMap(findTaggedViews)
        }

        private func outerScrollViews(_ view: UIView) -> [UIScrollView] {
            if let scroll = view as? UIScrollView {
                return [scroll]
            }
            return view.subviews.flatMap(outerScrollViews)
        }

        private func activeScroll() -> UIScrollView? {
            guard taggedView?.accessibilityIdentifier == "symptoms-scroll", let scroll, scroll.window != nil else {
                stop()
                return nil
            }
            return scroll
        }

        @objc private func observePan(_ pan: UIPanGestureRecognizer) {
            let callbackAtMs = Date().timeIntervalSince1970 * 1000
            guard let scroll = activeScroll() else { return }
            let owner = pan.view
            var fields: [String: Any] = [
                "traceID": traceID, "callbackAtMs": callbackAtMs, "state": pan.state.rawValue,
                "panID": identity(pan), "scrollViewID": identity(scroll),
                "ownerViewID": owner.map(identity) as Any? ?? NSNull(),
                "isScrollPan": pan === scroll.panGestureRecognizer, "ownerIsScrollView": owner === scroll,
                "scrollGeometry": geometry(scroll), "originalTouchRecipient": "unavailable",
            ]
            if let owner {
                // UIKit's owner coordinates use points; velocity uses points/second. These are one callback's direct reads.
                fields["locationInOwner"] = point(pan.location(in: owner))
                fields["translationInOwner"] = point(pan.translation(in: owner))
                fields["velocityInOwner"] = point(pan.velocity(in: owner))
            }
            if let window = scroll.window {
                let location = pan.location(in: window)
                fields["locationInWindow"] = point(location)
                // This is a fresh hitTest at the current pan location, never the original UITouch.view.
                fields["currentLocationHitTestViewID"] = window.hitTest(location, with: nil).map(identity) as Any? ?? NSNull()
            }
            record("symptom-native-scroll-pan", fields: fields)
        }

        @objc private func observeKeyboard(_ notification: Notification) {
            let notificationReceivedAtMs = Date().timeIntervalSince1970 * 1000
            guard let scroll = activeScroll() else { return }
            let info = notification.userInfo ?? [:]
            var fields: [String: Any] = [
                "traceID": traceID, "notificationReceivedAtMs": notificationReceivedAtMs,
                "phase": notification.name == UIResponder.keyboardWillChangeFrameNotification ? "will-change-frame" : "did-change-frame",
                "scrollViewID": identity(scroll), "scrollGeometry": geometry(scroll),
                "durationSeconds": (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber) as Any? ?? NSNull(),
            ]
            // Frame notification coordinates are screen coordinates; only the explicit geometry keys are retained.
            if let frame = info[UIResponder.keyboardFrameBeginUserInfoKey] as? NSValue {
                fields["beginFrameInScreen"] = rect(frame.cgRectValue)
            }
            if let frame = info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue {
                fields["endFrameInScreen"] = rect(frame.cgRectValue)
            }
            record("symptom-native-keyboard-frame", fields: fields)
        }

        private func record(_ event: String, fields: [String: Any]) {
            recordedCount += 1
            var observation = fields
            observation["event"] = event
            observation["sequence"] = recordedCount
            observation["receivedAtMs"] = Date().timeIntervalSince1970 * 1000
            traceEvents.append(observation)
            if traceEvents.count > 64 {
                traceEvents.removeFirst(traceEvents.count - 64)
            }
            TestLifecycleObservation.record(event, fields: fields)
        }

        private func geometry(_ scroll: UIScrollView) -> [String: Any] {
            var fields: [String: Any] = [
                "bounds": rect(scroll.bounds), "contentOffset": point(scroll.contentOffset),
                "contentSize": ["width": scroll.contentSize.width, "height": scroll.contentSize.height],
                "contentInset": insets(scroll.contentInset), "adjustedContentInset": insets(scroll.adjustedContentInset),
                "isDragging": scroll.isDragging, "isDecelerating": scroll.isDecelerating,
            ]
            if let window = scroll.window {
                fields["frameInWindow"] = rect(scroll.convert(scroll.bounds, to: window))
            }
            return fields
        }

        /// Weak object identity remains stable for a live UIKit object without retaining any observed view or content.
        private func identity(_ object: NSObject) -> String {
            if let existing = identities.object(forKey: object) {
                return existing as String
            }
            sequence += 1
            let value = "symptom-object-\(sequence)"
            identities.setObject(value as NSString, forKey: object)
            return value
        }

        private func point(_ point: CGPoint) -> [String: CGFloat] {
            ["x": point.x, "y": point.y]
        }

        private func rect(_ rect: CGRect) -> [String: CGFloat] {
            ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
        }

        private func insets(_ insets: UIEdgeInsets) -> [String: CGFloat] {
            ["top": insets.top, "left": insets.left, "bottom": insets.bottom, "right": insets.right]
        }
    }
#endif
