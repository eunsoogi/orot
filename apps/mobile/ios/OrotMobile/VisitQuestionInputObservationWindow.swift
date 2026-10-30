#if OROT_TESTS
    import UIKit

    /// Observe one synthetic visit-question editor without changing input, focus, hit testing or gesture delivery.
    @MainActor final class VisitQuestionInputObservationWindow: UIWindow {
        let trace: EncounterInputTrace
        private let windowID = UUID()
        private var step = 0
        private weak var identifiedInput: UITextView?
        private var nextInputIdentity = 0
        private var currentInputIdentity: Int?

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

        /// Match only this synthetic question selector; the identifier itself never leaves UIKit.
        private func owns(_ view: UIView) -> Bool {
            var node: UIView? = view
            var matched = false
            while let current = node, current !== self {
                if current.accessibilityIdentifier == "next-visit-question-text-0" {
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
