#if OROT_TESTS
    import UIKit

    /// Expose a live, test-only UIKit sample through the public accessibility value channel.
    @MainActor private final class VisitQuestionInputSnapshotMarker: UIView {
        weak var observationWindow: VisitQuestionInputObservationWindow?

        override var accessibilityValue: String? {
            get { observationWindow?.publicUIKitSnapshot() ?? "{\"status\":\"unavailable\"}" }
            set { super.accessibilityValue = newValue }
        }

        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = true
            isUserInteractionEnabled = false
            accessibilityIdentifier = "visit-question-input-observation"
            accessibilityLabel = "Visit question input observation"
        }

        required init?(coder _: NSCoder) {
            nil
        }
    }

    /// Observe one synthetic visit-question editor without changing input, focus, hit testing or gesture delivery.
    @MainActor final class VisitQuestionInputObservationWindow: UIWindow {
        let trace: EncounterInputTrace
        private let run: UUID
        private let windowID = UUID()
        private var step = 0
        private var publicSnapshotSequence = 0
        private weak var identifiedInput: UITextView?
        private var nextInputIdentity = 0
        private var currentInputIdentity: Int?
        private var lastTouch: [String: Any] = [:]
        private lazy var snapshotMarker = VisitQuestionInputSnapshotMarker(frame: CGRect(x: 0, y: 0, width: 1, height: 1))

        init(windowScene: UIWindowScene, run: UUID) {
            self.run = run
            trace = EncounterInputTrace(run: run)
            super.init(windowScene: windowScene)
            snapshotMarker.observationWindow = self
            addSubview(snapshotMarker)
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(changed(_:)), name: UITextView.textDidChangeNotification, object: nil)
            center.addObserver(self, selector: #selector(began(_:)), name: UITextView.textDidBeginEditingNotification, object: nil)
            center.addObserver(self, selector: #selector(ended(_:)), name: UITextView.textDidEndEditingNotification, object: nil)
        }

        required init?(coder _: NSCoder) {
            nil
        }

        override func sendEvent(_ event: UIEvent) {
            if UserDefaults.standard.string(forKey: "OROT_TEST_VISIT_QUESTION_TARGET") == "third",
               event.type == .touches, let touch = event.allTouches?.first(where: { $0.phase == .began })
            {
                let point = touch.location(in: self)
                lastTouch = ["x": point.x, "y": point.y, "uptime": ProcessInfo.processInfo.systemUptime, "viewClass": touch.view.map { String(describing: type(of: $0)) } ?? "none",
                             "insideTarget": touch.view.map(owns) ?? false]
            }
            let current: Int?
            if event.type == .presses {
                step += 1
                current = step
                trace.append(.beforePress, step: step, target: snapshot())
            } else {
                current = nil
            }
            super.sendEvent(event)
            if let current {
                trace.append(.afterPress, step: current, target: snapshot())
            }
        }

        @objc private func changed(_ note: Notification) {
            observe(note, phase: .textChanged)
        }

        @objc private func began(_ note: Notification) {
            observe(note, phase: .beganEditing)
        }

        @objc private func ended(_ note: Notification) {
            observe(note, phase: .endedEditing)
        }

        private func observe(_ note: Notification, phase: EncounterInputTrace.Phase) {
            guard let view = note.object as? UITextView, owns(view) else { return }
            step += 1
            trace.append(phase, step: step, target: snapshot())
        }

        /// Match only this synthetic question selector; the identifier itself never leaves UIKit.
        private func owns(_ view: UIView) -> Bool {
            var node: UIView? = view
            var matched = false
            while let current = node, current !== self {
                let target = UserDefaults.standard.string(forKey: "OROT_TEST_VISIT_QUESTION_TARGET") == "third" ? "next-visit-question-text-2" : "next-visit-question-text-0"
                if current.accessibilityIdentifier == target {
                    matched = true
                }
                node = current.superview
            }
            return node === self && matched
        }

        /// Keep only scalar state and a weakly tracked identity; ambiguity or traversal truncation has no range.
        func snapshot() -> EncounterInputTrace.Target {
            var stack: [UIView] = [self]
            var inputs: [UITextView] = []
            var visited = 0
            while !stack.isEmpty, visited < 2048 {
                let next = stack.removeLast()
                visited += 1
                if let input = next as? UITextView, owns(input) {
                    inputs.append(input)
                }
                stack.append(contentsOf: next.subviews)
            }
            let truncated = !stack.isEmpty
            let input = !truncated && inputs.count == 1 ? inputs.first : nil
            let range = input?.selectedRange
            return .init(matches: inputs.count, truncated: truncated, length: input?.text.utf16.count,
                         location: range?.location, selectionLength: range?.length, focused: input?.isFirstResponder,
                         keyWindow: isKeyWindow, inputIdentity: identity(for: input), windowID: windowID)
        }

        /// XCTest reads this accessibility value to sample the current UIKit selection synchronously.
        /// The bounded trace and returned payload share one run ID and contain scalar state only.
        func publicUIKitSnapshot() -> String {
            guard publicSnapshotSequence < 4096 else { return "{\"status\":\"overflow\"}" }
            publicSnapshotSequence += 1
            let target = snapshot()
            trace.append(.publicUIKitRead, step: step, target: target)
            let sample = EncounterInputTrace.UIKitSnapshot(
                run: run,
                sampleSequence: publicSnapshotSequence,
                sampleUptime: ProcessInfo.processInfo.systemUptime,
                target: target,
                recentEvents: trace.bufferedEvents,
                eventBufferTruncated: trace.bufferedEventsTruncated,
            )
            guard let data = try? JSONEncoder().encode(sample),
                  var object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            else {
                return "{\"status\":\"encoding-failed\"}"
            }
            if UserDefaults.standard.string(forKey: "OROT_TEST_VISIT_QUESTION_TARGET") == "third" {
                object["hitDiagnostic"] = inputHitDiagnostic()
            }
            guard let result = try? JSONSerialization.data(withJSONObject: object), let value = String(data: result, encoding: .utf8) else { return "{\"status\":\"encoding-failed\"}" }
            return value
        }

        /// Report only geometry and responder state; UIKit hit testing is read-only and never delivers a touch.
        private func inputHitDiagnostic() -> [String: Any] {
            var stack: [UIView] = [self]
            var matches: [UITextView] = []
            var visited = 0
            while !stack.isEmpty, visited < 2048 {
                let view = stack.removeLast()
                visited += 1
                if let input = view as? UITextView, owns(input) {
                    matches.append(input)
                }
                stack.append(contentsOf: view.subviews)
            }
            guard stack.isEmpty, matches.count == 1, let input = matches.first else {
                return ["status": stack.isEmpty ? "ambiguous-or-missing" : "truncated", "matches": matches.count]
            }
            let point = convert(input.accessibilityActivationPoint, from: nil as UIWindow?)
            let hit = hitTest(point, with: nil)
            let frame = input.convert(input.bounds, to: self)
            return ["status": "available", "editable": input.isEditable, "interactionEnabled": input.isUserInteractionEnabled,
                    "focused": input.isFirstResponder, "inputFrame": rect(frame), "activationPoint": ["x": point.x, "y": point.y],
                    "hitClass": hit.map { String(describing: type(of: $0)) } ?? "none",
                    "hitWithinInput": hit.map { $0 === input || $0.isDescendant(of: input) } ?? false,
                    "hitAncestorOfInput": hit.map { input.isDescendant(of: $0) } ?? false, "lastTouch": lastTouch]
        }

        private func rect(_ value: CGRect) -> [String: CGFloat] {
            ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height]
        }

        private func identity(for input: UITextView?) -> Int? {
            guard let input else { return nil }
            if identifiedInput === input {
                return currentInputIdentity
            }
            // Assign a per-window scalar when the weakly tracked view changes; never serialize object identity.
            nextInputIdentity += 1
            identifiedInput = input
            currentInputIdentity = nextInputIdentity
            return currentInputIdentity
        }
    }
#endif
