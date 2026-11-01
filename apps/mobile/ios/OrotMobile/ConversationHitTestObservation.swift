#if OROT_TESTS
    import CoreFoundation
    import UIKit

    /// An opted-in nonce arms one sample; periodic marker reads only return its cache.
    @MainActor
    final class ConversationHitObservationTrigger {
        private final class Registration {
            let session: String
            let owner: String
            let generation = UUID().uuidString
            init(session: String, owner: String) {
                self.session = session; self.owner = owner
            }
        }

        static let shared = ConversationHitObservationTrigger()
        private var session = ""
        private var owner = ""
        private var identity: ((NSObject) -> String)?
        private var result: [String: Any] = [:]
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
                sampled = false
                let name = "com.orot.tests.conversation-hit.\(session)" as CFString
                let registration = Registration(session: session, owner: owner)
                registrations.append(registration)
                activeRegistration = registration
                CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(registration).toOpaque(), { _, observer, name, _, _ in
                    guard let observer, let name, let session = (name.rawValue as String).components(separatedBy: ".").last else { return }
                    let registration = Unmanaged<Registration>.fromOpaque(observer).takeUnretainedValue()
                    DispatchQueue.main.async { ConversationHitObservationTrigger.shared.receive(session: session, owner: registration.owner, generation: registration.generation) }
                }, name, nil, .deliverImmediately)
            }
            return result
        }

        func invalidate(owner: String) {
            guard self.owner == owner else { return }
            removeObserver()
            session = ""
            self.owner = ""
            identity = nil
            result = [:]
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

        func receive(session: String, owner: String, generation: String) {
            guard session == self.session, owner == self.owner, generation == activeRegistration?.generation, !sampled, let identity else { return }
            sampled = true
            let received = Date().timeIntervalSince1970 * 1000
            result = ["session": session, "receivedAtMs": received, "sampleCount": 1, "sample": ConversationHitTestObservation.snapshot(identity: identity)]
        }
    }

    /// Samples fixed controls without reading message text or arbitrary accessibility metadata.
    enum ConversationHitTestObservation {
        private static let roles = ["rag-conversation-send", "rag-conversation-history", "rag-conversation-input", "rag-conversation-sessions-toggle", "rag-conversation-new-session", "navigation-page-action-overflow", "navigation-page-action-toolbar", "navigation-toolbar", "navigation-back", "navigation-home"]

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
