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

    struct ApprovedOutput {
        let function: String
        let proof: UUID
        let text: String
        let kind: LiveNativeResultDispatchAuthority.ResultKind
        let sourceCurrent: () -> Bool
        let retire: () -> Void
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
    private let outputs: [ApprovedOutput]
    private var next = 0
    private var pending: UUID?
    private var terminal = false

    init?(owner: Owner, functions: [String], outputs: [ApprovedOutput], owns: @escaping (Owner) -> Bool) {
        guard (2 ... 8).contains(outputs.count), functions == outputs.map(\.function),
              [owner.call, owner.session, owner.delegation, owner.response].allSatisfy(RealtimeVoiceToolLease.validID),
              functions.allSatisfy(RealtimeVoiceToolLease.validID), Set(functions).count == functions.count,
              Set(outputs.map(\.proof)).count == outputs.count,
              owns(owner), outputs.allSatisfy({ $0.kind.allows($0.text) && $0.sourceCurrent() }), owns(owner)
        else { return nil }
        self.owner = owner
        self.outputs = outputs
        self.owns = owns
    }

    func reserveWireFrames() -> [[String: Any]]? {
        guard !queued, current(), !terminal, !queued else { return nil }
        queued = true
        return outputs.map { output in
            ["type": "response.item.create", "event_id": UUID().uuidString,
             "item": ["type": "function_call_output", "call_id": output.function, "output": output.text]]
        } + [["type": "response.create", "event_id": UUID().uuidString]]
    }

    func matches(_ function: String, text: String, at index: Int) -> Bool {
        outputs.indices.contains(index) && outputs[index].function == function && outputs[index].text == text
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
        outputs.forEach { $0.retire() }
    }

    private func current() -> Bool {
        owns(owner) && outputs.allSatisfy { $0.sourceCurrent() } && owns(owner)
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
