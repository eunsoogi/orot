#if OROT_TESTS
    import UIKit

    /// An opted-in test window observes original touch delivery without adding recognizers or changing hit testing.
    @MainActor final class HealthReviewObservationWindow: UIWindow {
        enum Phase: String, Codable, Sendable { case began, ended, cancelled }
        struct Record: Codable, Sendable {
            let launch: UUID
            let sequence: Int
            let touch: Int
            let phase: Phase
            let touchUptime: TimeInterval
            let capturedUptime: TimeInterval
            let point: [Double]
            let touchCount: Int
            let multipleTouches: Bool
            let geometry: HealthReviewFormSnapshot
            let keyboardInScreen: [Double]?
            let keyboardObservedUptime: TimeInterval?
        }

        private let launch: UUID
        private let writer: Writer
        private var active: [ObjectIdentifier: (number: Int, multiple: Bool)] = [:]
        private var touchSequence = 0
        private var sequence = 0
        private var keyboard: [Double]?
        private var keyboardUptime: TimeInterval?

        init(windowScene: UIWindowScene, launch: UUID) {
            self.launch = launch
            writer = Writer(launch: launch)
            super.init(windowScene: windowScene)
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)),
                                                   name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
        }

        required init?(coder _: NSCoder) {
            nil
        }

        /// Missing, invalid or absent opt-in uses the exact original UIWindow construction at the call site.
        static func session(defaults: UserDefaults = .standard) -> UUID? {
            defaults.string(forKey: "OROT_TEST_FORM_OBSERVATION").flatMap(UUID.init(uuidString:))
        }

        override func sendEvent(_ event: UIEvent) {
            FormObservationDispatch.around(before: { self.capture(event, terminal: false) },
                                           after: { self.capture(event, terminal: true) })
            {
                super.sendEvent(event)
            }
        }

        @objc private func keyboardChanged(_ notification: Notification) {
            guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
            keyboard = HealthReviewFormSnapshot.rect(frame.cgRectValue)
            keyboardUptime = ProcessInfo.processInfo.systemUptime
        }

        /// These are dispatch boundaries, not settled deceleration. Copy scalars now; never retain events, touches or views.
        private func capture(_ event: UIEvent, terminal: Bool) {
            guard event.type == .touches, let touches = event.allTouches else { return }
            // Track overlap before phase/route filtering: a second finger outside the form can leave both endpoints single-touch.
            if touches.count > 1 {
                for identity in Array(active.keys) {
                    active[identity]?.multiple = true
                }
            }
            for touch in touches {
                let phase: Phase
                if !terminal, touch.phase == .began {
                    phase = .began
                } else if terminal, touch.phase == .ended {
                    phase = .ended
                } else if terminal, touch.phase == .cancelled {
                    phase = .cancelled
                } else {
                    continue
                }
                let identity = ObjectIdentifier(touch)
                if phase == .began {
                    touchSequence += 1
                    // Missing terminal delivery cannot grow bookkeeping indefinitely; discarded pairs remain unmatchable.
                    if active.count >= 32 {
                        active.removeAll()
                    }
                    active[identity] = (touchSequence, touches.count > 1)
                }
                let tracked = active[identity]
                if terminal {
                    active.removeValue(forKey: identity)
                }
                guard let tracked, let geometry = HealthReviewFormSnapshot.capture(in: self, receiver: touch.view) else { continue }
                sequence += 1
                let screenPoint = convert(touch.location(in: self), to: screen.coordinateSpace)
                writer.append(Record(launch: launch, sequence: sequence, touch: tracked.number, phase: phase,
                                     touchUptime: touch.timestamp, capturedUptime: ProcessInfo.processInfo.systemUptime,
                                     point: HealthReviewFormSnapshot.point(screenPoint), touchCount: touches.count,
                                     multipleTouches: tracked.multiple, geometry: geometry,
                                     keyboardInScreen: keyboard, keyboardObservedUptime: keyboardUptime))
            }
        }

        /// One serial background owner writes a bounded scalar snapshot; capture sequence is independent of file-write time.
        private final class Writer: @unchecked Sendable {
            private let queue = DispatchQueue(label: "com.orot.tests.form-observation-writer")
            private let lock = NSLock()
            private let url: URL?
            private var records: [Record] = []
            private var captured = 0
            private var scheduled = false
            private struct Snapshot: Encodable {
                let captured: Int
                let dropped: Int
                let records: [Record]
            }

            init(launch: UUID) {
                url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
                    .appendingPathComponent("form-scroll-\(launch.uuidString).json")
            }

            func append(_ record: Record) {
                lock.lock()
                captured += 1
                records.append(record)
                if records.count > 128 {
                    records.removeFirst(records.count - 128)
                }
                // Coalesce pending writes too: at most one queued flush plus the currently writing scalar snapshot.
                guard !scheduled else { lock.unlock(); return }
                scheduled = true
                lock.unlock()
                queue.async {
                    self.lock.lock()
                    let snapshot = Snapshot(captured: self.captured, dropped: self.captured - self.records.count, records: self.records)
                    self.scheduled = false
                    self.lock.unlock()
                    guard let url = self.url else { return }
                    do {
                        let data = try JSONEncoder().encode(snapshot)
                        try data.write(to: url, options: .atomic)
                    } catch {
                        // Missing/truncated/failed output remains UNKNOWN. Raw filesystem errors may contain private paths.
                        print("OROT_FORM_NATIVE_UNKNOWN")
                    }
                }
            }
        }
    }
#endif
