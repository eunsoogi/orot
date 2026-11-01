#if OROT_TESTS
    import CoreFoundation
    import UIKit

    /// An opted-in nonce arms one sample; periodic marker reads only return its cache.
    @MainActor
    final class ConversationHitObservationTrigger {
        private final class Registration {
            let session: String
            let owner: String
            let generation = UUID().uuidString; weak var dockRoot: UIView?
            init(session: String, owner: String) {
                self.session = session; self.owner = owner
            }
        }

        static let shared = ConversationHitObservationTrigger()
        private var session = ""
        private var owner = ""
        private var identity: ((NSObject) -> String)?
        private var result: [String: Any] = [:]
        private var dockSlots: [String: [String: Any]] = [:]
        private var sampled = false
        // Retain callback contexts until process exit so an already queued notification cannot dereference freed memory.
        private var registrations: [Registration] = []
        private var activeRegistration: Registration?

        func cached(session: String?, owner: String, identity: @escaping (NSObject) -> String) -> [String: Any] {
            guard let session, UUID(uuidString: session) != nil else {
                invalidate(owner: owner)
                return [:]
            }
            if self.session != session || self.owner != owner {
                removeObserver()
                self.session = session
                self.owner = owner
                self.identity = identity
                result = [:]
                dockSlots = [:]
                sampled = false
                let registration = Registration(session: session, owner: owner); let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0.01 }; registration.dockRoot = windows.count == 1 ? windows.first?.rootViewController?.view : nil; _ = registration.dockRoot?.keyboardLayoutGuide
                registrations.append(registration)
                activeRegistration = registration
                for phase in ["legacy", "send-ready", "cancel-ready"] {
                    let suffix = phase == "legacy" ? "" : ".\(phase)"
                    let name = "com.orot.tests.conversation-hit.\(session)\(suffix)" as CFString
                    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(registration).toOpaque(), { _, observer, name, _, _ in
                        guard let observer, let name else { return }
                        let registration = Unmanaged<Registration>.fromOpaque(observer).takeUnretainedValue()
                        let raw = name.rawValue as String
                        let phase = raw.hasSuffix(".send-ready") ? "send-ready" : raw.hasSuffix(".cancel-ready") ? "cancel-ready" : "legacy"
                        DispatchQueue.main.async { ConversationHitObservationTrigger.shared.receive(session: registration.session, owner: registration.owner, generation: registration.generation, phase: phase) }
                    }, name, nil, .deliverImmediately)
                }
            }
            guard !dockSlots.isEmpty else { return result }
            return result.merging(["dockSlots": dockSlots], uniquingKeysWith: { _, new in new })
        }

        func invalidate(owner: String) {
            guard self.owner == owner else { return }
            removeObserver()
            session = ""
            self.owner = ""
            identity = nil
            result = [:]
            dockSlots = [:]
            sampled = false
        }

        private func removeObserver() {
            if let activeRegistration {
                CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(activeRegistration).toOpaque())
            }
            activeRegistration = nil
        }

        var generationForTesting: String? {
            activeRegistration?.generation
        }

        func receive(session: String, owner: String, generation: String, phase: String = "legacy") {
            guard session == self.session, owner == self.owner, generation == activeRegistration?.generation, let identity else { return }
            if phase != "legacy" {
                guard ["send-ready", "cancel-ready"].contains(phase), dockSlots[phase] == nil else { return }
                dockSlots[phase] = ["session": session, "owner": owner, "generation": generation, "phase": phase, "sampleCount": 1, "sample": ConversationHitTestObservation.dockSnapshot(phase: phase, identity: identity, expectedRoot: activeRegistration?.dockRoot)]
                return
            }
            guard !sampled else { return }
            sampled = true
            let received = Date().timeIntervalSince1970 * 1000
            result = ["session": session, "receivedAtMs": received, "sampleCount": 1, "sample": ConversationHitTestObservation.snapshot(identity: identity)]
        }
    }

    /// Samples fixed controls without reading message text or arbitrary accessibility metadata.
    enum ConversationHitTestObservation {
        private static let roles = ["rag-conversation-send", "rag-conversation-history", "rag-conversation-input", "rag-conversation-sessions-toggle", "rag-conversation-new-session", "navigation-page-action-overflow", "navigation-page-action-toolbar", "navigation-toolbar", "navigation-back", "navigation-home"]

        /// Samples the real controls and keyboard guide in a single window without inspecting their content.
        static func dockSnapshot(phase: String, identity: (NSObject) -> String, expectedRoot: UIView?) -> [String: Any] {
            let start = Date().timeIntervalSince1970 * 1000
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0.01 }
            guard windows.count == 1, let window = windows.first, let scene = window.windowScene,
                  let root = window.rootViewController?.view, root.window === window, root === expectedRoot
            else { return ["status": "unavailable", "reason": "window-or-root", "windowCount": windows.count, "startedAtMs": start] }
            let rootFrame = root.convert(root.bounds, to: window); let keyboard = root.convert(root.keyboardLayoutGuide.layoutFrame, to: window)
            guard rootFrame.equalTo(window.bounds), !keyboard.isEmpty,
                  keyboard.height > root.safeAreaInsets.bottom, window.bounds.contains(keyboard)
            else { return ["status": "unavailable", "reason": "keyboard-or-root", "rootFrame": rect(rootFrame), "windowBounds": rect(window.bounds), "keyboard": rect(keyboard), "startedAtMs": start] }
            let actionRole = phase == "send-ready" ? "rag-conversation-send" : "rag-conversation-cancel"
            let wanted = ["rag-conversation-history", "rag-conversation-composer", "rag-conversation-composer-field", "rag-conversation-input", actionRole]
            var queue: [UIView] = [window], found: [String: [UIView]] = [:], navigation: [CGRect] = [], count = 0
            while !queue.isEmpty, count < 3000 {
                let view = queue.removeFirst(); count += 1
                if let role = view.accessibilityIdentifier, ["navigation-toolbar", "navigation-page-action-toolbar"].contains(role), view.window === window, !view.isHidden, view.alpha > 0.01 {
                    navigation.append(view.convert(view.bounds, to: window))
                }
                if let role = view.accessibilityIdentifier, wanted.contains(role), view.window === window {
                    if role == "rag-conversation-input", view is UITextView {
                        found[role, default: []].append(view)
                    } else if role == actionRole, view is UIButton {
                        found[role, default: []].append(view)
                    } else if ["rag-conversation-history", "rag-conversation-composer", "rag-conversation-composer-field"].contains(role) {
                        found[role, default: []].append(view)
                    }
                }
                queue.append(contentsOf: view.subviews)
            }
            guard queue.isEmpty, wanted.allSatisfy({ found[$0]?.count == 1 }), let action = found[actionRole]?.first as? UIButton
            else { return ["status": "unavailable", "startedAtMs": start, "counts": wanted.map { found[$0]?.count ?? 0 }] }
            var controls: [[String: Any]] = [], valid = true, transition = window.rootViewController?.transitionCoordinator?.isAnimated == true
            for role in wanted {
                guard let view = found[role]?.first else { continue }
                let frame = view.convert(view.bounds, to: window)
                var clipped = frame, ancestor: UIView? = view
                while let node = ancestor, node !== window {
                    if node.clipsToBounds {
                        clipped = clipped.intersection(node.convert(node.bounds, to: window))
                    }
                    if node.isHidden || node.alpha <= 0.01 || !node.isUserInteractionEnabled {
                        valid = false
                    }
                    if !(node.layer.animationKeys() ?? []).isEmpty {
                        transition = true
                    }
                    if let presentation = node.layer.presentation(), !presentation.frame.equalTo(node.layer.frame) {
                        transition = true
                    }
                    ancestor = node.superview
                }
                guard ancestor === window else { valid = false; continue }
                let interactive = role != "rag-conversation-history" && role != "rag-conversation-composer"
                if frame.isEmpty || !window.bounds.contains(frame) || !clipped.equalTo(frame) || (interactive && (frame.intersects(keyboard) || navigation.contains(where: { $0.intersects(frame) }))) {
                    valid = false
                }
                controls.append(["role": role, "frame": rect(frame), "clippedFrame": rect(clipped)])
            }
            if let history = found["rag-conversation-history"]?.first, let composer = found["rag-conversation-composer"]?.first,
               history.convert(history.bounds, to: window).maxY > composer.convert(composer.bounds, to: window).minY + 1
            {
                valid = false
            }
            let actionFrame = action.convert(action.bounds, to: window)
            var hit = window.hitTest(CGPoint(x: actionFrame.midX, y: actionFrame.midY), with: nil)
            while let node = hit, node !== action {
                hit = node.superview
            }
            if hit !== action || !action.isEnabled {
                valid = false
            }
            return ["status": transition ? "transition" : valid ? "available" : "occluded", "windowID": identity(window), "sceneID": identity(scene), "windowBounds": rect(window.bounds), "keyboard": rect(keyboard), "controls": controls, "startedAtMs": start, "endedAtMs": Date().timeIntervalSince1970 * 1000]
        }

        static func snapshot(identity: (NSObject) -> String) -> [String: Any] {
            precondition(Thread.isMainThread)
            let start = Date().timeIntervalSince1970 * 1000
            let visibleWindows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter { !$0.isHidden && $0.alpha > 0.01 }
            let keys = visibleWindows.filter(\.isKeyWindow)
            guard keys.count == 1, let window = keys.first, let scene = window.windowScene else { return ["status": "unavailable", "windowCount": keys.count, "startedAtMs": start, "endedAtMs": Date().timeIntervalSince1970 * 1000] }
            var queue = visibleWindows.map { $0 as UIView }, matches: [String: [UIView]] = [:], visited = 0
            while !queue.isEmpty, visited < 3000 {
                let view = queue.removeFirst()
                visited += 1
                if let role = view.accessibilityIdentifier, roles.contains(role) {
                    matches[role, default: []].append(view)
                }
                queue.append(contentsOf: view.subviews)
            }
            let buttons = (matches["rag-conversation-send"] ?? []).compactMap { $0 as? UIButton }
            var result: [String: Any] = ["status": !queue.isEmpty ? "truncated" : buttons.count == 1 ? "available" : buttons.isEmpty ? "unavailable" : "ambiguous", "startedAtMs": start, "windowID": identity(window), "sceneID": identity(scene), "screenID": identity(window.screen), "windowBounds": rect(window.bounds), "windowFrameInScreen": rect(window.convert(window.bounds, to: nil as UIWindow?)), "windowFrameInScene": rect(scene.coordinateSpace.convert(window.bounds, from: window)), "units": "points", "candidateCount": buttons.count]
            if #available(iOS 16.0, *) {
                result["orientation"] = scene.effectiveGeometry.interfaceOrientation.rawValue
            }
            result["controls"] = roles.flatMap { role in
                (matches[role] ?? []).map { view in
                    ["role": role, "id": identity(view), "windowID": view.window.map(identity) ?? "unavailable", "frame": rect(view.convert(view.bounds, to: window)), "hidden": view.isHidden, "alpha": view.alpha] as [String: Any]
                }
            }
            if buttons.count == 1, let send = buttons.first {
                let frame = send.convert(send.bounds, to: window)
                var ancestors: [[String: Any]] = [], parent = send.superview, nearestScroll: UIScrollView?
                while let view = parent, view !== window, ancestors.count < 100 {
                    if nearestScroll == nil {
                        nearestScroll = view as? UIScrollView
                    }
                    let model = view.convert(view.bounds, to: window)
                    let row: [String: Any] = ["id": identity(view), "frame": rect(model), "clips": view.clipsToBounds, "hidden": view.isHidden, "alpha": view.alpha, "interactionEnabled": view.isUserInteractionEnabled, "hasMask": view.layer.mask != nil]
                    ancestors.append(row)
                    parent = view.superview
                }
                result["ancestors"] = ancestors
                result["ancestorComplete"] = parent === window
                if let scroll = nearestScroll {
                    result["nearestScroll"] = ["id": identity(scroll), "frame": rect(scroll.convert(scroll.bounds, to: window)), "offset": ["x": scroll.contentOffset.x, "y": scroll.contentOffset.y], "size": ["width": scroll.contentSize.width, "height": scroll.contentSize.height], "inset": ["top": scroll.adjustedContentInset.top, "bottom": scroll.adjustedContentInset.bottom]]
                }
                result["sendID"] = identity(send)
                result["sendFrame"] = rect(frame)
                result["sendWindowID"] = send.window.map(identity) ?? "unavailable"
                result["sendAccessibilityFrameInScreen"] = rect(send.accessibilityFrame)
                result["sendAccessibilityFrameInWindow"] = rect(window.convert(send.accessibilityFrame, from: nil as UIWindow?))
                let activation = window.convert(send.accessibilityActivationPoint, from: nil as UIWindow?)
                result["centerHit"] = hit(window, point: CGPoint(x: frame.midX, y: frame.midY), send: send, matches: matches, identity: identity)
                result["activationHit"] = hit(window, point: activation, send: send, matches: matches, identity: identity)
            }
            result["endedAtMs"] = Date().timeIntervalSince1970 * 1000
            return result
        }

        private static func hit(_ window: UIWindow, point: CGPoint, send: UIView, matches: [String: [UIView]], identity: (NSObject) -> String) -> [String: Any] {
            guard point.x.isFinite, point.y.isFinite, let view = window.hitTest(point, with: nil) else { return ["status": "unavailable"] }
            var cursor: UIView? = view
            var role = "other"
            while let candidate = cursor {
                if candidate === send {
                    role = "send"; break
                }
                if let match = roles.first(where: { role in (matches[role] ?? []).contains { $0 === candidate } }) {
                    role = match; break
                }
                cursor = candidate.superview
            }
            return ["status": "available", "id": identity(view), "role": role, "x": point.x, "y": point.y]
        }

        private static func rect(_ value: CGRect) -> [String: Any] {
            NavigationGeometryTestObservation.finiteRect(value)
        }
    }
#endif
