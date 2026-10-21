#if OROT_TESTS && targetEnvironment(simulator)
    import UIKit

    /// Passive, synthetic-fixture-only evidence. No delegate, selection, text or responder is changed.
    @MainActor
    final class TestTextInputObservation: NSObject {
        private static let shared = TestTextInputObservation()
        private weak var editor: UITextView?
        private var timer: Timer?
        private var editorID = UUID().uuidString
        private var events: [Event] = []
        private var previous: State?
        private var samples = 0
        private var droppedEvents = 0
        private var firstSampleMs: Double?
        private var lastSampleMs: Double?
        private var lastSampleUptimeMs: Double?
        private var maximumGapMs = 0.0
        private var lastPersistedMs = 0.0

        private struct State: Codable, Equatable {
            let firstResponder: Bool
            let length: Int
            let selectionStart: Int?
            let selectionEnd: Int?
        }

        private struct Event: Codable {
            let timeMs: Double
            let uptimeMs: Double
            let source: String
            let state: State
        }

        private struct Snapshot: Codable {
            let processIdentifier: Int32
            let editorID: String
            let identifier: String
            let samples: Int
            let firstSampleMs: Double?
            let lastSampleMs: Double?
            let maximumGapMs: Double
            let droppedEvents: Int
            let events: [Event]
        }

        static func startIfRequested() {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_INPUT_OBSERVATION") == "YES",
                  UserDefaults.standard.string(forKey: "OROT_TRANSCRIPTION_PROBE_MODE") == "recording-library-visual" else { return }
            for name in [UITextView.textDidBeginEditingNotification, UITextView.textDidEndEditingNotification, UITextView.textDidChangeNotification] {
                NotificationCenter.default.addObserver(shared, selector: #selector(shared.changed(_:)), name: name, object: nil)
            }
        }

        @objc private func changed(_ notification: Notification) {
            guard let view = notification.object as? UITextView, view.accessibilityIdentifier == "transcript-input-0" else { return }
            if editor == nil {
                // One weak editor identity per process; a replacement view must not inherit its timeline or timer.
                guard previous == nil else { return }
                editor = view
                editorID = UUID().uuidString
                // At most 1800 samples after the first editor event; run-loop delays can stretch their interval.
                timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.capture("sample") }
                }
            }
            guard editor === view else { return }
            let source = notification.name == UITextView.textDidBeginEditingNotification ? "begin" :
                notification.name == UITextView.textDidEndEditingNotification ? "end" : "change"
            // Capture UIKit scalars synchronously with notification delivery; persistence never rereads the view.
            capture(source)
        }

        private func capture(_ source: String) {
            guard let editor else { timer?.invalidate(); timer = nil; return }
            let now = Date().timeIntervalSince1970 * 1000
            let uptime = ProcessInfo.processInfo.systemUptime * 1000
            if source == "sample" {
                samples += 1
                firstSampleMs = firstSampleMs ?? now
                if let lastSampleUptimeMs {
                    maximumGapMs = max(maximumGapMs, uptime - lastSampleUptimeMs)
                }
                lastSampleMs = now
                lastSampleUptimeMs = uptime
            }
            let range = editor.selectedRange
            let length = editor.text.utf16.count
            let valid = range.location != NSNotFound && range.location <= length && range.length <= length - range.location
            let state = State(firstResponder: editor.isFirstResponder, length: length,
                              selectionStart: valid ? range.location : nil, selectionEnd: valid ? range.location + range.length : nil)
            // Sparse unchanged-state samples retain coverage across a command whose selection never changes.
            if state != previous || source != "sample" || now - lastPersistedMs >= 500 {
                events.append(Event(timeMs: now, uptimeMs: uptime, source: source, state: state))
                previous = state
                if events.count > 256 {
                    events.removeFirst(); droppedEvents += 1
                }
                let snapshot = Snapshot(processIdentifier: ProcessInfo.processInfo.processIdentifier, editorID: editorID,
                                        identifier: "transcript-input-0", samples: samples, firstSampleMs: firstSampleMs,
                                        lastSampleMs: lastSampleMs, maximumGapMs: maximumGapMs, droppedEvents: droppedEvents, events: events)
                // Immutable scalar data crosses the queue; disk work cannot inspect or retain UIKit objects.
                if let data = try? JSONEncoder().encode(snapshot) {
                    Self.persistence.async { try? data.write(to: Self.fileURL, options: .atomic) }
                }
                lastPersistedMs = now
            }
            if samples >= 1800 {
                timer?.invalidate(); timer = nil
            }
        }

        private nonisolated static let persistence = DispatchQueue(label: "com.orot.tests.input-observation")
        private nonisolated static var fileURL: URL {
            FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("OrotTestTextInputObservation.json")
        }

        /// The owned cold reset exports only our typed scalars, then removes the diagnostic before the next fixture.
        nonisolated static func consume() -> [String: Any]? {
            guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
            defer { try? FileManager.default.removeItem(at: fileURL) }
            guard let data = try? Data(contentsOf: fileURL), data.count <= 131_072,
                  let value = try? JSONDecoder().decode(Snapshot.self, from: data), value.identifier == "transcript-input-0",
                  let sanitized = try? JSONEncoder().encode(value),
                  let result = try? JSONSerialization.jsonObject(with: sanitized) as? [String: Any] else { return ["status": "unavailable"] }
            return result
        }
    }
#endif
