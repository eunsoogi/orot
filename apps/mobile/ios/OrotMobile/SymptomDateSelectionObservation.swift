#if OROT_TESTS
    import CoreGraphics
    import Foundation

    /// Keep one candidate region inside each real clipping rectangle without expanding either boundary.
    enum SymptomSelectionIntersection {
        static func intersect(_ region: CGRect, _ clip: CGRect) -> CGRect? {
            guard valid(region), valid(clip) else { return nil }
            let value = region.intersection(clip)
            return valid(value) ? value : nil
        }

        private static func valid(_ rect: CGRect) -> Bool {
            !rect.isNull && !rect.isInfinite && rect.width > 0 && rect.height > 0 && [rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy(\.isFinite)
        }
    }

    #if canImport(UIKit)
    import CoreFoundation
    import UIKit

    /// One registered fixture session captures at most one public selection sample per phase.
    @MainActor
    final class SymptomDateSelectionObservation {
        private final class Registration {
            let session: String, owner: String, generation = UUID().uuidString
            init(session: String, owner: String) {
                self.session = session; self.owner = owner
            }
        }

        static let shared = SymptomDateSelectionObservation()
        private var registration: Registration?
        private var retained: [Registration] = []
        private var identity: ((NSObject) -> String)?
        private var samples: [String: [String: Any]] = [:]
        private var pendingAfter: Double?

        func cached(session: String?, owner: String, identity: @escaping (NSObject) -> String) -> [String: Any] {
            guard let session, UUID(uuidString: session) != nil else { invalidate(owner: owner); return [:] }
            if registration?.session != session || registration?.owner != owner {
                remove()
                let value = Registration(session: session, owner: owner)
                retained.append(value); registration = value; self.identity = identity; samples = [:]; pendingAfter = nil
                for phase in ["before", "after"] {
                    let name = "com.orot.tests.date-selection.\(session).\(phase)" as CFString
                    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(value).toOpaque(), { _, pointer, name, _, _ in
                        guard let pointer, let name, let phase = (name.rawValue as String).components(separatedBy: ".").last else { return }
                        let value = Unmanaged<Registration>.fromOpaque(pointer).takeUnretainedValue()
                        DispatchQueue.main.async { SymptomDateSelectionObservation.shared.receive(session: value.session, owner: value.owner, generation: value.generation, phase: phase) }
                    }, name, nil, .deliverImmediately)
                }
            }
            // Capture the post-gesture sample once, in the same main-actor marker transaction as current geometry.
            if let received = pendingAfter, let identity = self.identity {
                pendingAfter = nil
                capture(session: session, phase: "after", received: received, identity: identity)
            }
            return ["session": session, "samples": samples]
        }

        func invalidate(owner: String) {
            guard registration?.owner == owner else { return }
            remove(); registration = nil; identity = nil; samples = [:]; pendingAfter = nil
        }

        private func remove() {
            if let registration {
                CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(registration).toOpaque())
            }
        }

        var generationForTesting: String? {
            registration?.generation
        }

        func receive(session: String, owner: String, generation: String, phase: String) {
            guard ["before", "after"].contains(phase), registration?.session == session, registration?.owner == owner,
                  registration?.generation == generation, let identity else { return }
            if samples[phase] != nil || (phase == "after" && pendingAfter != nil) {
                if phase == "after" {
                    pendingAfter = nil
                }
                samples[phase] = ["phase": phase, "sampleCount": 2, "status": "duplicate"]
                return
            }
            let received = Date().timeIntervalSince1970 * 1000
            if phase == "after" {
                pendingAfter = received
                return
            }
            capture(session: session, phase: phase, received: received, identity: identity)
        }

        private func capture(session: String, phase: String, received: Double, identity: (NSObject) -> String) {
            let sample = Self.snapshot(identity: identity).merging(["phase": phase, "sampleCount": 1, "receivedAtMs": received, "session": session]) { _, new in new }
            samples[phase] = sample
            // A synthetic opt-in records this one receipt independently of the periodic marker delivery.
            if let data = try? JSONSerialization.data(withJSONObject: sample, options: [.sortedKeys]), let line = String(data: data, encoding: .utf8) {
                NSLog("OROT_DATE_SELECTION %@", line)
            }
        }

        /// Read positions and object ownership only; never read the document contents.
        static func snapshot(identity: (NSObject) -> String) -> [String: Any] {
            let started = Date().timeIntervalSince1970 * 1000
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter { !$0.isHidden && $0.alpha > 0 }
            let keys = windows.filter(\.isKeyWindow)
            var pending = windows.map { $0 as UIView }, matches: [UITextField] = [], views: [UIView] = [], visited = 0
            while visited < 3000, let view = pending.popLast() {
                visited += 1
                views.append(view)
                if let field = view as? UITextField, field.accessibilityIdentifier == "symptom-onset-date" {
                    matches.append(field)
                }
                pending.append(contentsOf: view.subviews)
            }
            var result: [String: Any] = ["startedAtMs": started, "candidateCount": matches.count, "truncated": !pending.isEmpty, "windowCount": keys.count]
            if pending.isEmpty, keys.count == 1, matches.count == 1, let field = matches.first, let window = keys.first, field.window === window {
                let beginning = field.beginningOfDocument
                let length = field.offset(from: beginning, to: field.endOfDocument)
                if let selected = field.selectedTextRange {
                    let start = field.offset(from: beginning, to: selected.start), end = field.offset(from: beginning, to: selected.end)
                    if length >= 0, start >= 0, start <= end, end <= length {
                        result.merge(["status": "available", "viewID": identity(field), "windowID": identity(window), "focused": field.isFirstResponder, "documentLength": length, "selectionStart": start, "selectionEnd": end]) { _, new in new }
                        result.merge(sceneObservation(field: field, window: window, identity: identity)) { _, new in new }
                        if end > start {
                            var rejection: String?, clipFailure: [String: Any]?
                            let geometry = selectionGeometry(field: field, range: selected, window: window, rejection: { rejection = $0 }, clipFailure: { clipFailure = $0 }, identity: identity)
                            if let geometry {
                                result["selectionGeometry"] = geometry
                                result["dock"] = SymptomDockControlObservation.capture(views: views, window: window, truncated: !pending.isEmpty, identity: identity)
                            } else if let rejection {
                                result["selectionGeometryRejection"] = rejection
                                result["selectionClipFailure"] = clipFailure
                            }
                        }
                    }
                }
            }
            if result["status"] == nil {
                result["status"] = "unavailable"
            }
            result["endedAtMs"] = Date().timeIntervalSince1970 * 1000
            return result
        }

        /// Record only observed scene state; an incomplete responder chain cannot establish stability.
        private static func sceneObservation(field: UITextField, window: UIWindow, identity: (NSObject) -> String) -> [String: Any] {
            guard #available(iOS 26.0, *), let scene = window.windowScene, let root = window.rootViewController else { return [:] }
            var responder: UIResponder? = field, depth = 0, foundOwner = false, foundRoot = false, transitioning = scene.effectiveGeometry.isInteractivelyResizing
            while let current = responder, depth < 64 {
                if let controller = current as? UIViewController {
                    foundOwner = true; transitioning = transitioning || controller.transitionCoordinator != nil
                    if controller === root { foundRoot = true }
                }
                responder = current.next; depth += 1
            }
            guard responder == nil, foundOwner, foundRoot else { return [:] }
            return ["sceneID": identity(scene), "sceneOrientation": scene.effectiveGeometry.interfaceOrientation.rawValue, "sceneTransitionObserved": transitioning]
        }

        /// Derive one visible selection region from complete public clipping and hit-test its exact center.
        static func selectionGeometry(field: UITextField, range: UITextRange, window: UIWindow, rejection: (String) -> Void = { _ in }, clipFailure: ([String: Any]) -> Void = { _ in }, identity: (NSObject) -> String) -> [String: Any]? {
            // Record only the first failed public geometry boundary without collecting input contents.
            func reject(_ reason: String) -> [String: Any]? { rejection(reason); return nil }
            guard #available(iOS 17.4, *) else { return reject("unsupportedOS") }
            let input = field.textInputView
            guard field.isFirstResponder, field.window === window, input.window === window, input === field || input.isDescendant(of: field), let scene = window.windowScene else { return reject("inputOwnership") }
            let allRects = field.selectionRects(for: range)
            guard allRects.allSatisfy({ value in
                let rect = value.rect
                return !rect.isNull && !rect.isInfinite && [rect.minX, rect.minY, rect.maxX, rect.maxY].allSatisfy(\.isFinite)
            }) else { return reject("nonfiniteSelectionRects") }
            let rects = allRects.filter { $0.rect.width > 0 && $0.rect.height > 0 }
            guard rects.count == 1, let selected = rects.first else { return reject("selectionRectCount") }
            guard selected.transform.isIdentity else { return reject("selectionTransform") }
            let rect = input.convert(selected.rect, to: window), fieldFrame = field.convert(field.bounds, to: window)
            guard finite(rect), finite(fieldFrame), window.bounds.contains(rect), fieldFrame.contains(rect) else { return reject("selectionContainment") }
            var visible = rect
            var current: UIView? = input, reachedWindow = false, reachedField = false, depth = 0, scrollers: [UIScrollView] = []
            while let view = current, depth < 64 {
                guard view.layer.mask == nil, view.transform.isIdentity, CATransform3DIsIdentity(view.layer.transform), view === window || view.window === window else { return reject("ancestorOwnershipOrTransform") }
                if view.clipsToBounds || view.layer.masksToBounds {
                    let clip = view.convert(view.bounds, to: window)
                    guard let intersection = SymptomSelectionIntersection.intersect(visible, clip) else {
                        // Preserve only public geometry from the first failed clip in this same sample.
                        var failure: [String: Any] = ["valid": finite(clip), "depth": depth, "ancestorID": identity(view), "isInput": view === input, "isField": view === field, "isScroll": view is UIScrollView, "clipsToBounds": view.clipsToBounds, "masksToBounds": view.layer.masksToBounds, "selection": NavigationGeometryTestObservation.finiteRect(rect), "field": NavigationGeometryTestObservation.finiteRect(fieldFrame)]
                        if finite(clip) { failure["clip"] = NavigationGeometryTestObservation.finiteRect(clip) }
                        if let scroll = view as? UIScrollView {
                            failure["insideField"] = scroll.isDescendant(of: field)
                            failure["tracking"] = scroll.isTracking; failure["dragging"] = scroll.isDragging; failure["decelerating"] = scroll.isDecelerating
                            let offset = scroll.contentOffset, size = scroll.contentSize, inset = scroll.contentInset
                            if [offset.x, offset.y, size.width, size.height, inset.top, inset.left, inset.bottom, inset.right].allSatisfy(\.isFinite) {
                                failure["scroll"] = ["offsetX": offset.x, "offsetY": offset.y, "width": size.width, "height": size.height, "insetTop": inset.top, "insetLeft": inset.left, "insetBottom": inset.bottom, "insetRight": inset.right]
                            }
                        }
                        clipFailure(failure)
                        return reject("ancestorClipping")
                    }
                    visible = intersection
                }
                if view === field {
                    reachedField = true
                }
                if let scroll = view as? UIScrollView {
                    guard !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { return reject("scrollMotion") }
                    if reachedField {
                        scrollers.append(scroll)
                    }
                }
                if view === window {
                    reachedWindow = true; break
                }
                current = view.superview
                depth += 1
            }
            guard reachedWindow, reachedField, scrollers.count == 1, let scroll = scrollers.first else { return reject("scrollAncestry") }
            guard !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { return reject("scrollMotion") }
            guard let hit = window.hitTest(CGPoint(x: visible.midX, y: visible.midY), with: nil), hit === field || hit.isDescendant(of: field) else { return reject("hitOwnership") }
            let screenRect = window.convert(rect, to: window.screen.coordinateSpace)
            let screenVisible = window.convert(visible, to: window.screen.coordinateSpace)
            let screenField = window.convert(fieldFrame, to: window.screen.coordinateSpace)
            let screenWindow = window.convert(window.bounds, to: window.screen.coordinateSpace)
            guard finite(screenRect), finite(screenVisible), finite(screenField), finite(screenWindow) else { return reject("screenConversion") }
            let orientation: Int = if #available(iOS 16.0, *) {
                scene.effectiveGeometry.interfaceOrientation.rawValue
            } else {
                0
            }
            return ["selection": NavigationGeometryTestObservation.finiteRect(screenRect), "visibleSelection": NavigationGeometryTestObservation.finiteRect(screenVisible), "field": NavigationGeometryTestObservation.finiteRect(screenField), "window": NavigationGeometryTestObservation.finiteRect(screenWindow), "inputViewID": identity(input), "orientation": orientation, "hitOwned": true,
                    "scroll": ["id": identity(scroll), "frame": NavigationGeometryTestObservation.finiteRect(window.convert(scroll.convert(scroll.bounds, to: window), to: window.screen.coordinateSpace)), "offset": ["x": scroll.contentOffset.x, "y": scroll.contentOffset.y], "bounds": NavigationGeometryTestObservation.finiteRect(scroll.bounds)]]
        }

        private static func finite(_ value: CGRect) -> Bool {
            !value.isNull && !value.isInfinite && value.width > 0 && value.height > 0 && [value.minX, value.minY, value.maxX, value.maxY].allSatisfy(\.isFinite)
        }
    }
    #endif
#endif
