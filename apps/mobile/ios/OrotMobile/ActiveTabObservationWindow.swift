import UIKit

#if OROT_TESTS && targetEnvironment(simulator)
    @MainActor private final class ActiveTabTraceMarker: UIView {
        weak var observationWindow: ActiveTabObservationWindow?
        override var accessibilityValue: String? {
            get { observationWindow?.snapshot() ?? "{\"status\":\"unavailable\"}" }
            set { super.accessibilityValue = newValue }
        }

        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = true
            isUserInteractionEnabled = false
            accessibilityIdentifier = "active-tab-native-observation"
        }

        required init?(coder _: NSCoder) {
            nil
        }
    }

    /// Records touch delivery and its scroll owner's offset without changing event dispatch.
    @MainActor final class ActiveTabObservationWindow: UIWindow {
        private let run: UUID
        private var sequence = 0
        private let scrollIDs = NSMapTable<UIScrollView, NSNumber>(keyOptions: .weakMemory, valueOptions: .strongMemory)
        private let touchIDs = NSMapTable<UITouch, NSNumber>(keyOptions: .weakMemory, valueOptions: .strongMemory)
        private var nextScrollID = 0
        private var nextTouchID = 0
        private var events: [[String: Any]] = []
        private var overflow = false
        private lazy var marker = ActiveTabTraceMarker(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        init(windowScene: UIWindowScene, run: UUID) {
            self.run = run
            super.init(windowScene: windowScene)
            marker.observationWindow = self
            addSubview(marker)
        }

        required init?(coder _: NSCoder) {
            nil
        }

        func snapshot() -> String {
            let targets = ["overview-screen", "records-layout", "appointments-scroll"]
            var pending = subviews
            var ready: [String] = []
            var visited = 0
            while visited < 2048, let view = pending.popLast() {
                visited += 1
                pending.append(contentsOf: view.subviews)
                if let id = view.accessibilityIdentifier, targets.contains(id),
                   view.window === self, !view.isHidden, view.alpha > 0, !view.bounds.isEmpty
                {
                    let point = view.convert(CGPoint(x: view.bounds.midX, y: view.bounds.midY), to: self)
                    if bounds.contains(point), let hit = hitTest(point, with: nil),
                       hit === view || hit.isDescendant(of: view)
                    {
                        ready.append(id)
                    }
                }
            }
            let value: [String: Any] = ["run": run.uuidString, "events": events, "overflow": overflow,
                                        "sampleTick": mach_absolute_time(), "visible": ready,
                                        "truncated": !pending.isEmpty]
            guard let data = try? JSONSerialization.data(withJSONObject: value),
                  let result = String(data: data, encoding: .utf8) else { return "{\"status\":\"unavailable\"}" }
            return result
        }

        override func sendEvent(_ event: UIEvent) {
            if event.type == .touches {
                for touch in event.allTouches ?? [] {
                    guard [.began, .moved, .ended].contains(touch.phase) else { continue }
                    var node = touch.view
                    var kind = "other"
                    var scroll: UIScrollView?
                    while let view = node {
                        if let id = view.accessibilityIdentifier,
                           ["navigation-tab-overview", "navigation-tab-records", "records-section-schedule",
                            "schedule-open-appointments", "appointments-scroll"].contains(id)
                        {
                            kind = id
                        }
                        if scroll == nil {
                            scroll = view as? UIScrollView
                        }
                        node = view.superview
                    }
                    sequence += 1
                    let offset = scroll?.contentOffset.y ?? 0
                    var scrollID = 0
                    let touchID: Int
                    if touch.phase != .began, let existing = touchIDs.object(forKey: touch) {
                        touchID = existing.intValue
                    } else {
                        nextTouchID += 1
                        touchID = nextTouchID
                        touchIDs.setObject(NSNumber(value: touchID), forKey: touch)
                    }
                    if let scroll {
                        if let existing = scrollIDs.object(forKey: scroll) {
                            scrollID = existing.intValue
                        } else {
                            nextScrollID += 1
                            scrollID = nextScrollID
                            scrollIDs.setObject(NSNumber(value: scrollID), forKey: scroll)
                        }
                    }
                    if events.count < 1024 {
                        events.append(["sequence": sequence, "tick": mach_absolute_time(), "phase": touch.phase.rawValue,
                                       "target": kind, "touch": touchID, "scroll": scrollID, "offset": offset])
                    } else {
                        overflow = true
                    }
                    if touch.phase == .ended {
                        touchIDs.removeObject(forKey: touch)
                    }
                }
            }
            super.sendEvent(event)
        }
    }
#endif
