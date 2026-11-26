import Foundation

/// Dormant typed native adapter for a manifest-approved multi-output transport.
/// A future call owner must supply one independently approved result per slot.
@MainActor
final class LiveNativeResultBatch {
    struct Owner: Equatable {
        let call: String
        let session: String
        let epoch: UUID
        let delegation: String
        let response: String
    }

    /// Capture the authority's exact owned output, not a caller-supplied proof ID.
    @MainActor
    final class Proof {
        let owner: Owner
        let function: String
        let text: String
        let kind: LiveNativeResultDispatchAuthority.ResultKind
        private let sourceCurrent: (Owner, String, Data) -> Bool
        private let release: () -> Void
        private(set) var reserved = false, retired = false

        init(owner: Owner, function: String, text: String, kind: LiveNativeResultDispatchAuthority.ResultKind,
             sourceCurrent: @escaping (Owner, String, Data) -> Bool, release: @escaping () -> Void)
        {
            self.owner = owner; self.function = function; self.text = text; self.kind = kind
            self.sourceCurrent = sourceCurrent; self.release = release
        }

        func check() -> Bool {
            !retired && sourceCurrent(owner, function, Data(text.utf8)) && !retired
        }

        fileprivate func reserve() {
            reserved = true
        }

        func retire(reservedByBatch: Bool) {
            guard !retired, reserved == reservedByBatch else { return }
            retired = true; release()
        }
    }

    enum Frame: Equatable {
        case output(function: String, text: String)
        case continuation
    }

    private var queued = false
    var frameCount: Int {
        outputs.count + 1
    }

    private let owner: Owner
    private let owns: (Owner) -> Bool
    private let outputs: [Proof]
    private var next = 0
    private var pending: UUID?
    private var terminal = false

    init?(owner: Owner, functions: [String], outputs: [Proof], owns: @escaping (Owner) -> Bool) {
        guard (2 ... 8).contains(outputs.count), functions == outputs.map(\.function),
              [owner.call, owner.session, owner.delegation, owner.response].allSatisfy(RealtimeVoiceToolLease.validID),
              functions.allSatisfy(RealtimeVoiceToolLease.validID), Set(functions).count == functions.count,
              Set(outputs.map(ObjectIdentifier.init)).count == outputs.count,
              outputs.allSatisfy({ $0.owner == owner && (!$0.reserved && !$0.retired) }),
              owns(owner), outputs.allSatisfy({ $0.kind.allows($0.text) && $0.check() }), owns(owner)
        else { return nil }
        self.owner = owner
        self.outputs = outputs
        self.owns = owns
    }

    func reserveWireFrames() -> [[String: Any]]? {
        guard !queued, current(), !terminal, !queued, outputs.allSatisfy({ !$0.reserved && !$0.retired }) else { return nil }
        outputs.forEach { $0.reserve() }
        queued = true
        return outputs.map { output in
            ["type": "response.item.create", "event_id": UUID().uuidString,
             "item": ["type": "function_call_output", "call_id": output.function, "output": output.text]]
        } + [["type": "response.create", "event_id": UUID().uuidString]]
    }

    func matches(_ function: String, text: String, at index: Int) -> Bool {
        outputs.indices.contains(index) && outputs[index].function == function && Data(outputs[index].text.utf8) == Data(text.utf8)
    }

    /// Call only at the oldest FIFO write's real synchronous handoff.
    /// The continuation cannot overtake an unacknowledged output.
    func submit(_ send: (Frame, UUID) -> Bool) -> Bool {
        guard queued, !terminal, pending == nil else { return false }
        guard current(), !terminal, pending == nil else { retire(); return false }
        let receipt = UUID()
        pending = receipt
        let frame: Frame = next == outputs.count ? .continuation : .output(function: outputs[next].function, text: outputs[next].text)
        if send(frame, receipt) {
            return true
        }
        retire()
        return false
    }

    func complete(_ receipt: UUID, succeeded: Bool) -> Bool {
        guard !terminal, pending == receipt else { return false }
        guard succeeded, current(), !terminal, pending == receipt else { retire(); return false }
        pending = nil
        if next == outputs.count {
            retire() // The exact continuation completion releases every source ticket.
        } else {
            next += 1
        }
        return true
    }

    func retire() {
        guard !terminal else { return }
        terminal = true
        pending = nil
        outputs.forEach { $0.retire(reservedByBatch: queued) }
    }

    private func current() -> Bool {
        owns(owner) && outputs.allSatisfy { $0.check() } && owns(owner)
    }
}

/// An exact approved tool batch, retained only by its current socket queue.
final class LiveQueuedToolPermit {
    private let current: () -> Bool
    private let batch: LiveNativeResultBatch?
    let ticket: LiveNativeResultDispatchAuthority.Ticket?
    private var retired = false
    var issued = false
    private(set) var continuationObservationRetired = false

    /// A submitted write cannot be recalled; its late callback no longer samples retired work.
    func retireQueueObservation() {
        continuationObservationRetired = true
        ticket?.retire()
        retireBatchIfPresent()
    }

    func retireBatchIfPresent() {
        guard let batch else { return }
        if Thread.isMainThread {
            MainActor.assumeIsolated { batch.retire() }
        } else {
            DispatchQueue.main.async { batch.retire() }
        }
    }

    init(current: @escaping () -> Bool, ticket: LiveNativeResultDispatchAuthority.Ticket? = nil, batch: LiveNativeResultBatch? = nil) {
        self.current = current
        self.ticket = ticket
        self.batch = batch
    }

    /// A failed check is permanent, even if settings later return to the same values.
    func authorizeHandoff() -> Bool {
        guard !retired, current() else { retired = true; return false }
        return !retired
    }

    func submit(_ send: (UUID?) -> Bool) -> Bool {
        if let batch {
            guard Thread.isMainThread else { return false }
            return MainActor.assumeIsolated {
                batch.submit { _, receipt in send(receipt) }
            }
        }
        if let ticket {
            return ticket.submit { _ = send(nil) }
        }
        return send(nil)
    }

    func reportContinuation(if permitted: Bool, since stamp: DispatchTime?, end: DispatchTime?, observe: ((LiveManagedToolLatency, UInt64) -> Void)?) {
        guard permitted, !continuationObservationRetired else { return }
        LiveManagedToolLatency.finish(.continuationSendCallback, since: stamp, observe: observe, at: end)
    }

    static func acceptsReceipt(_ required: Bool, owner: LiveQueuedToolPermit?, final: Bool, succeeded: Bool,
                               currentFrame: @autoclosure () -> Bool) -> Bool
    {
        guard required else { return true }
        guard let owner else { return false }
        return owner.verifyV3Callback(currentFrame: currentFrame(), final: final, succeeded: succeeded)
    }

    func verifyV3Callback(currentFrame: @autoclosure () -> Bool, final: Bool, succeeded: Bool) -> Bool {
        guard let ticket, ticket.requiresWireReceipt else { return true }
        guard currentFrame() else { return false }
        guard succeeded else { ticket.retire(); return true }
        guard authorizeHandoff(), currentFrame(), !final || ticket.acknowledgeWire()
        else { ticket.retire(); return false }
        return currentFrame()
    }

    func settleBatch(_ receipt: UUID, result: Bool) -> Bool {
        guard let batch, Thread.isMainThread else { return false }
        return MainActor.assumeIsolated { batch.complete(receipt, succeeded: result) }
    }

    private func frameCountAllowed(_ count: Int) -> Bool {
        if let batch {
            guard Thread.isMainThread else { return false }
            return MainActor.assumeIsolated { batch.frameCount == count }
        }
        return ticket == nil ? (2 ... 9).contains(count) : count == 2
    }

    private func allows(_ value: String, call: String, index: Int) -> Bool {
        guard let batch else { return (ticket?.resultKind ?? .aggregate).allows(value) }
        guard Thread.isMainThread else { return false }
        return MainActor.assumeIsolated { batch.matches(call, text: value, at: index) }
    }

    /// Permit only the Live Responses output envelope and a single final continuation.
    /// This is not user approval; the native owner must separately approve these exact bytes.
    func prepare(_ frames: [[String: Any]]) -> [RealtimeSocketWrite]? {
        guard frameCountAllowed(frames.count), authorizeHandoff() else { return nil }
        var calls = Set<String>()
        var events = Set<UUID>()
        var writes: [RealtimeSocketWrite] = []
        for (index, frame) in frames.enumerated() {
            guard let type = frame["type"] as? String,
                  let eventID = frame["event_id"] as? String, let command = UUID(uuidString: eventID),
                  events.insert(command).inserted else { return nil }
            if index == frames.count - 1 {
                guard type == "response.create", frame.count == 2 else { return nil }
            } else {
                guard type == "response.item.create", frame.count == 3,
                      let item = frame["item"] as? [String: Any], item.count == 3,
                      item["type"] as? String == "function_call_output",
                      let call = item["call_id"] as? String, RealtimeVoiceToolLease.validID(call),
                      calls.insert(call).inserted,
                      let value = item["output"] as? String, allows(value, call: call, index: index)
                else { return nil }
            }
            guard let data = try? JSONSerialization.data(withJSONObject: frame),
                  let text = String(data: data, encoding: .utf8) else { return nil }
            writes.append(RealtimeSocketWrite(text: text, isInput: false, permit: self, isFinalContinuation: index == frames.count - 1))
        }
        return writes
    }
}
