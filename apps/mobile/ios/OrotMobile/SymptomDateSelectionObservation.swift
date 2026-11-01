#if OROT_TESTS
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

        func cached(session: String?, owner: String, identity: @escaping (NSObject) -> String) -> [String: Any] {
            guard let session, UUID(uuidString: session) != nil else { invalidate(owner: owner); return [:] }
            if registration?.session != session || registration?.owner != owner {
                remove()
                let value = Registration(session: session, owner: owner)
                retained.append(value); registration = value; self.identity = identity; samples = [:]
                for phase in ["before", "after"] {
                    let name = "com.orot.tests.date-selection.\(session).\(phase)" as CFString
                    CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(value).toOpaque(), { _, pointer, name, _, _ in
                        guard let pointer, let name, let phase = (name.rawValue as String).components(separatedBy: ".").last else { return }
                        let value = Unmanaged<Registration>.fromOpaque(pointer).takeUnretainedValue()
                        DispatchQueue.main.async { SymptomDateSelectionObservation.shared.receive(session: value.session, owner: value.owner, generation: value.generation, phase: phase) }
                    }, name, nil, .deliverImmediately)
                }
            }
            return ["session": session, "samples": samples]
        }

        func invalidate(owner: String) {
            guard registration?.owner == owner else { return }
            remove(); registration = nil; identity = nil; samples = [:]
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
            if samples[phase] != nil {
                samples[phase] = ["phase": phase, "sampleCount": 2, "status": "duplicate"]
                return
            }
            let received = Date().timeIntervalSince1970 * 1000
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
            var pending = windows.map { $0 as UIView }, matches: [UITextField] = [], visited = 0
            while visited < 3000, let view = pending.popLast() {
                visited += 1
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
                    }
                }
            }
            if result["status"] == nil {
                result["status"] = "unavailable"
            }
            result["endedAtMs"] = Date().timeIntervalSince1970 * 1000
            return result
        }
    }
#endif
