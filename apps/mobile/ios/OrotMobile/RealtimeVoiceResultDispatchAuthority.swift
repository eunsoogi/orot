import Foundation

/// No database, credentials, tool arguments or output bytes cross this fence.
final class LiveNativeResultDispatchAuthority: @unchecked Sendable {
    enum ResultKind: Equatable {
        case aggregate
        case canonicalHealth

        func allows(_ output: String) -> Bool {
            switch self {
            case .aggregate: (1 ... 2048).contains(output.utf8.count)
            case .canonicalHealth: RealtimeVoiceCanonicalHealthAdmission.validResult(output)
            }
        }
    }

    final class Ticket: @unchecked Sendable {
        private enum Phase { case pending, claimed, output, finished, retired }
        private let lock = NSLock()
        let call: String
        let challenge: String
        let resultKind: ResultKind
        private var phase = Phase.pending
        private struct Resolver: @unchecked Sendable { let call: (Bool) -> Void }
        private var completion: Resolver?
        private var queueRetirement: Resolver?
        private var deadline: DispatchWorkItem?
        private var deadlineAt: DispatchTime?

        fileprivate init(call: String, challenge: String, resultKind: ResultKind) {
            self.call = call
            self.challenge = challenge
            self.resultKind = resultKind
        }

        func claim() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard phase == .pending else { return false }
            phase = .claimed
            return true
        }

        func bind(timeout: DispatchTimeInterval = .seconds(10), _ completion: @escaping (Bool) -> Void) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard phase == .claimed, self.completion == nil else { return false }
            self.completion = Resolver(call: completion)
            let expires = DispatchTime.now() + timeout
            let work = DispatchWorkItem { [weak self] in self?.retire() }
            deadline = work
            deadlineAt = expires
            DispatchQueue.main.asyncAfter(deadline: expires, execute: work)
            return true
        }

        func observeQueueRetirement(_ observer: @escaping (Bool) -> Void) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard phase == .claimed, completion != nil, queueRetirement == nil else { return false }
            queueRetirement = Resolver(call: observer)
            return true
        }

        /// Only the real synchronous native socket submission runs under this lock.
        /// No React, owner checks, transport completion or arbitrary callbacks run under it.
        func submit(_ send: () -> Void) -> Bool {
            lock.lock()
            guard completion != nil, phase == .claimed || phase == .output else {
                lock.unlock()
                return false
            }
            guard let deadlineAt, DispatchTime.now() < deadlineAt else {
                lock.unlock()
                retire()
                return false
            }
            let last = phase == .output
            phase = last ? .finished : .output
            send()
            let callback = last ? completion : nil
            if last {
                completion = nil
                queueRetirement = nil
                deadline?.cancel()
                deadline = nil
                self.deadlineAt = nil
            }
            lock.unlock()
            callback?.call(true)
            return true
        }

        func retire() {
            lock.lock()
            guard phase != .finished, phase != .retired else { lock.unlock(); return }
            let callback = completion
            let observer = queueRetirement
            let partial = phase == .output
            completion = nil
            queueRetirement = nil
            deadline?.cancel()
            deadline = nil
            deadlineAt = nil
            phase = .retired
            lock.unlock()
            DispatchQueue.main.async {
                observer?.call(partial)
                callback?.call(false)
            }
        }
    }

    private let lock = NSLock()
    private var current: Ticket?

    func begin(call: String, challenge: String) -> Ticket {
        install(call: call, challenge: challenge, resultKind: .aggregate)
    }

    func beginCanonicalHealth(
        call: String,
        challenge: String,
        admission: RealtimeVoiceCanonicalHealthAdmission,
        base: LiveResponsesSettingsGrant,
        key: String,
        read: (String, String) -> [String: Any]?,
    ) -> Ticket? {
        guard admission.current(base: base, key: key, read: read) else { return nil }
        return install(call: call, challenge: challenge, resultKind: .canonicalHealth)
    }

    /// Common V3 owns a separate authority instance and can mint only the stock canonical result ticket.
    func beginV3Canonical(call: String, challenge: String, current: () -> Bool) -> Ticket? {
        guard current() else { return nil }
        return install(call: call, challenge: challenge, resultKind: .canonicalHealth)
    }

    private func install(call: String, challenge: String, resultKind: ResultKind) -> Ticket {
        let next = Ticket(call: call, challenge: challenge, resultKind: resultKind)
        lock.lock()
        let old = current
        current = next
        lock.unlock()
        old?.retire()
        return next
    }

    private func exact(call: String, challenge: String) -> Ticket? {
        lock.lock()
        defer { lock.unlock() }
        guard current?.call == call, current?.challenge == challenge else { return nil }
        return current
    }

    func claim(call: String, challenge: String) -> Bool {
        exact(call: call, challenge: challenge)?.claim() == true
    }

    func retire(call: String, challenge: String) -> Bool {
        // A mismatched or stale key can never affect a replacement ticket.
        exact(call: call, challenge: challenge)?.retire()
        return true
    }
}
