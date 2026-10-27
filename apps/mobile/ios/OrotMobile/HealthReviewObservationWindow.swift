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
            let geometry: HealthReviewFormSnapshot?
            let keyboardInScreen: [Double]?
            let keyboardObservedUptime: TimeInterval?
            var losses: [HealthReviewFormSnapshot.Loss] = []
            var trackingDiscarded = 0
        }

        /// Only this synchronous dispatch-local pair references UIKit; the writer receives Record scalars alone.
        private struct Pending {
            let touch: UITouch
            let record: Record
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
            var terminals: [Pending] = []
            FormObservationDispatch.around(before: { terminals = self.prepare(event) },
                                           after: { self.finish(terminals) })
            {
                super.sendEvent(event)
            }
        }

        @objc private func keyboardChanged(_ notification: Notification) {
            guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
            keyboard = HealthReviewFormSnapshot.rect(frame.cgRectValue)
            keyboardUptime = ProcessInfo.processInfo.systemUptime
        }

        /// Copy terminal identity before UIKit can mutate phase, view, timestamp or event membership during dispatch.
        private func prepare(_ event: UIEvent) -> [Pending] {
            guard event.type == .touches, let touches = event.allTouches else { return [] }
            // Overlap outside the form still invalidates a single-touch interpretation.
            if touches.count > 1 {
                for identity in Array(active.keys) {
                    active[identity]?.multiple = true
                }
            }
            var terminals: [Pending] = []
            for touch in touches {
                let phase: Phase
                switch touch.phase {
                case .began: phase = .began
                case .ended: phase = .ended
                case .cancelled: phase = .cancelled
                default: continue
                }
                let identity = ObjectIdentifier(touch)
                var discarded = 0
                if phase == .began {
                    touchSequence += 1
                    if active.count >= 32 {
                        discarded = active.count
                        active.removeAll()
                    }
                    active[identity] = (touchSequence, touches.count > 1)
                }
                let tracked = active[identity]
                if phase != .began {
                    active.removeValue(forKey: identity)
                }
                // Untracked terminal delivery still gets an independent diagnostic number and an incomplete envelope.
                if tracked == nil {
                    touchSequence += 1
                }
                sequence += 1
                let screenPoint = convert(touch.location(in: self), to: screen.coordinateSpace)
                var record = Record(launch: launch, sequence: sequence, touch: tracked?.number ?? touchSequence, phase: phase,
                                    touchUptime: touch.timestamp, capturedUptime: ProcessInfo.processInfo.systemUptime,
                                    point: HealthReviewFormSnapshot.point(screenPoint), touchCount: touches.count,
                                    multipleTouches: tracked?.multiple ?? (touches.count > 1), geometry: nil,
                                    keyboardInScreen: keyboard, keyboardObservedUptime: keyboardUptime)
                if tracked == nil {
                    record.losses.append(.trackingMissing)
                }
                if discarded > 0 {
                    record.losses.append(.trackingOverflow); record.trackingDiscarded = discarded
                }
                if phase == .began {
                    write(record, receiver: touch.view)
                } else {
                    terminals.append(Pending(touch: touch, record: record))
                }
            }
            return terminals
        }

        /// Post geometry is sampled after the exact original dispatch; pre-terminal geometry never fills its absence.
        private func finish(_ terminals: [Pending]) {
            for pending in terminals {
                write(pending.record, receiver: pending.touch.view)
            }
        }

        private func write(_ envelope: Record, receiver: UIView?) {
            let collection = HealthReviewFormSnapshot.capture(in: self, receiver: receiver)
            var losses = envelope.losses
            if let loss = collection.loss {
                losses.append(loss)
            }
            var record = Record(launch: envelope.launch, sequence: envelope.sequence, touch: envelope.touch, phase: envelope.phase,
                                touchUptime: envelope.touchUptime, capturedUptime: ProcessInfo.processInfo.systemUptime,
                                point: envelope.point, touchCount: envelope.touchCount, multipleTouches: envelope.multipleTouches,
                                geometry: collection.geometry, keyboardInScreen: keyboard, keyboardObservedUptime: keyboardUptime)
            record.losses = losses
            record.trackingDiscarded = envelope.trackingDiscarded
            writer.append(record)
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
