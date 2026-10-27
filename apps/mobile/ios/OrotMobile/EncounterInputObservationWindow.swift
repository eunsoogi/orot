#if OROT_TESTS
    import UIKit

    /// Passive dispatch samples: XCTest key synthesis is not guaranteed to traverse this boundary.
    /// Missing press pairs remain UNKNOWN; afterPress means dispatch returned, not React settling.
    @MainActor final class EncounterInputObservationWindow: UIWindow {
        let trace: EncounterInputTrace
        private var step = 0

        init(windowScene: UIWindowScene, run: UUID) {
            trace = EncounterInputTrace(run: run)
            super.init(windowScene: windowScene)
            let center = NotificationCenter.default
            center.addObserver(self, selector: #selector(changed(_:)), name: UITextView.textDidChangeNotification, object: nil)
            center.addObserver(self, selector: #selector(began(_:)), name: UITextView.textDidBeginEditingNotification, object: nil)
            center.addObserver(self, selector: #selector(ended(_:)), name: UITextView.textDidEndEditingNotification, object: nil)
        }

        required init?(coder _: NSCoder) {
            nil
        }

        override func sendEvent(_ event: UIEvent) {
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

        /// The fixed synthetic editor selector is used only for matching and never serialized.
        private func owns(_ view: UIView) -> Bool {
            var node: UIView? = view
            var matched = false
            while let current = node, current !== self {
                if current.accessibilityIdentifier == "encounter-text-candidate-0" {
                    matched = true
                }
                node = current.superview
            }
            return node === self && matched
        }

        /// Never choose an arbitrary editor or retain UI objects in a record; ambiguity/truncation has no range.
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
                         location: range?.location, selectionLength: range?.length, focused: input?.isFirstResponder, keyWindow: isKeyWindow)
        }

        /// Native uptime is receipt time. It must not be mistaken for JS occurrence or native prop application.
        func react(_ event: EncounterInputTrace.ReactEvent, sequence: Int, length: Int) {
            step += 1
            trace.append(.reactReceipt, step: step, target: snapshot(), reactEvent: event, reactSequence: sequence, reactLength: length)
        }
    }
#endif
