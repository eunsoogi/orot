import Foundation
@testable import Orot
import XCTest

/// A Live streaming transcript has no finalized input witness for the old approval lease.
extension RealtimeVoiceLifecycleTests {
    func testLiveRejectsLegacyModelAndAnyAttemptToEnableToolsBeforeAdmission() throws {
        let audio = Audio(), socket = Socket()
        var requested = 0, rejected = 0
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership,
                                     permission: { _ in requested += 1 }, foreground: { true }, emit: { _, _ in })
        for (model, tools) in [("gpt-realtime-2.1", false), ("gpt-realtime-2.1-mini", false), ("gpt-live-1.1", true)] {
            call.open("call", model: model, key: "synthetic", language: "auto", enableTools: tools) { result in
                if case .failure = result {
                    rejected += 1
                }
            }
        }
        XCTAssertEqual(rejected, 3)
        XCTAssertEqual(requested, 0)
        XCTAssertEqual(socket.opens, 0)
        XCTAssertEqual(audio.starts, 0)
        XCTAssertNil(call.token)
        let unclaimed = try ownership.reserve()
        try ownership.release(unclaimed)
    }

    func testUnfinishedLiveTranscriptAndDelegationNeverEmitRecordsOrToolRequests() async throws {
        let audio = Audio(), socket = Socket()
        var emitted: [String] = []
        let call = RealtimeVoiceCall(audio: audio, socket: socket,
                                     ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }),
                                     permission: { $0(true) }, foreground: { true }, emit: { name, _ in emitted.append(name) })
        await opening(call, socket: socket)
        socket.received?(started())
        let config = socket.sent.first?["session"] as? [String: Any]
        XCTAssertNil(config?["tools"])
        XCTAssertEqual((config?["delegation"] as? [String: String])?["type"], "client")
        let events: [[String: Any]] = [
            ["type": "session.input_transcript.delta", "delta": "synthetic", "event_id": "transcript", "start_ms": 1, "end_ms": 2],
            ["type": "session.output_transcript.delta", "delta": "synthetic", "event_id": "output", "start_ms": 2, "end_ms": 3],
            ["type": "session.delegation.created", "event_id": "delegation", "offset_ms": 3,
             "delegation": ["id": "candidate", "target": "client", "type": "delegation"]],
            ["type": "input_audio_buffer.committed", "item_id": "legacy-input"],
            ["type": "conversation.item.input_audio_transcription.completed", "item_id": "legacy-input", "transcript": "synthetic"],
            ["type": "response.created", "response": ["id": "legacy"]],
            ["type": "response.function_call_arguments.done", "response_id": "legacy", "call_id": "candidate",
             "name": "orot_conversation", "arguments": "{}"],
            ["type": "response.done", "response": ["id": "legacy", "status": "completed"]],
        ]
        let before = socket.sent.count
        for event in events + events {
            socket.received?(event)
        }
        XCTAssertFalse(emitted.contains("VoiceRealtimeToolCall"))
        XCTAssertFalse(emitted.contains("VoiceRealtimeTranscript"))
        XCTAssertFalse(call.resolveTool("call", toolCallID: "candidate", responseID: "legacy", output: "synthetic"))
        XCTAssertEqual(socket.sent.count, before)
        try call.pause("call")
        XCTAssertFalse(call.resolveTool("call", toolCallID: "candidate", responseID: "legacy", output: "synthetic"))
        try call.stop("call")
        XCTAssertFalse(call.resolveTool("call", toolCallID: "candidate", responseID: "legacy", output: "synthetic"))
    }

    /// Retain original authority guarantees as focused tests of the old inert lease, without
    /// reopening a legacy provider or manufacturing a completed Live source.
    func testLegacyLeaseStillRequiresBoundInputCompletedResponseAndOneShotExactIDs() {
        let lease = RealtimeVoiceToolLease()
        lease.reset(enabled: true)
        lease.commit("input")
        lease.bind("response")
        lease.receive(responseID: "response", toolCallID: "tool", name: "orot_conversation", arguments: " { } ")
        XCTAssertNil(lease.pending)
        XCTAssertNil(lease.complete("stale", successful: true))
        XCTAssertEqual(lease.complete("response", successful: true)?.inputItemID, "input")
        XCTAssertFalse(lease.consume(toolCallID: "other", responseID: "response"))
        XCTAssertFalse(lease.consume(toolCallID: "tool", responseID: "other"))
        XCTAssertTrue(lease.consume(toolCallID: "tool", responseID: "response"))
        XCTAssertFalse(lease.consume(toolCallID: "tool", responseID: "response"))
    }

    func testLegacyLeaseRejectsArgumentsIDsNoncompletionAndRevokedPending() {
        for arguments in ["", "[]", "{\"recordId\":\"synthetic\"}", "null", String(repeating: " ", count: 1025)] {
            let lease = RealtimeVoiceToolLease()
            lease.reset(enabled: true)
            lease.commit("input")
            lease.bind("response")
            lease.receive(responseID: "response", toolCallID: "tool", name: "orot_conversation", arguments: arguments)
            XCTAssertNil(lease.complete("response", successful: true))
        }
        XCTAssertFalse(RealtimeVoiceToolLease.validID("bad id"))
        XCTAssertFalse(RealtimeVoiceToolLease.validID(String(repeating: "a", count: 129)))
        XCTAssertFalse(RealtimeVoiceToolLease.validID("한글"))
        for completed in [true, false] {
            let lease = RealtimeVoiceToolLease()
            lease.reset(enabled: true)
            lease.commit("input")
            lease.bind("response")
            lease.receive(responseID: "response", toolCallID: "tool", name: "orot_conversation", arguments: "{}")
            XCTAssertEqual(lease.complete("response", successful: completed) != nil, completed)
            XCTAssertEqual(lease.invalidate(), completed ? "tool" : nil)
            XCTAssertFalse(lease.consume(toolCallID: "tool", responseID: "response"))
        }
    }

    func testLegacyLeaseRejectsReplaysAndAmbiguousInputEpochs() {
        let lease = RealtimeVoiceToolLease()
        lease.reset(enabled: true)
        lease.commit("input")
        lease.bind("response")
        lease.receive(responseID: "response", toolCallID: "tool", name: "orot_conversation", arguments: "{}")
        XCTAssertNotNil(lease.complete("response", successful: true))
        lease.invalidate()
        lease.commit("new-input")
        lease.bind("new-response")
        lease.receive(responseID: "new-response", toolCallID: "tool", name: "orot_conversation", arguments: "{}")
        XCTAssertNil(lease.complete("new-response", successful: true))
        lease.commit("input_a")
        lease.invalidate()
        lease.commit("input_b")
        lease.bind("late_response")
        lease.receive(responseID: "late_response", toolCallID: "other", name: "orot_conversation", arguments: "{}")
        XCTAssertNil(lease.complete("late_response", successful: true))
        XCTAssertFalse(lease.enabled)
    }

    func testLegacyLeaseBudgetDoesNotEvictTombstones() {
        let lease = RealtimeVoiceToolLease()
        lease.reset(enabled: true)
        for index in 0 ... 64 {
            lease.commit("input_\(index)"); lease.bind("response_\(index)")
            lease.receive(responseID: "response_\(index)", toolCallID: "tool_\(index)", name: "orot_conversation", arguments: "{}")
            let request = lease.complete("response_\(index)", successful: true)
            XCTAssertEqual(request != nil, index < 64)
            lease.invalidate()
        }
        XCTAssertFalse(lease.enabled)
    }

    /// Exercise the exact production encoder and queued authority without opening a socket.
    func testManagedToolQueueRequiresExactFrameKindsAndFreshEgressPermit() {
        var authority = true
        let permit = LiveQueuedToolPermit(current: { authority })
        let frames = syntheticManagedToolFrames()
        let queued = permit.prepare(frames)
        XCTAssertEqual(queued?.count, 2)
        XCTAssertTrue(queued?.allSatisfy { $0.permit === permit && !$0.isInput } ?? false)
        let first = queued?.first.flatMap { try? JSONSerialization.jsonObject(with: Data($0.text.utf8)) }
        let item = (first as? [String: Any])?["item"] as? [String: String]
        XCTAssertEqual(item?["output"], "synthetic")
        XCTAssertEqual(item?["call_id"], "fixture-call")
        XCTAssertTrue(permit.authorizeHandoff())
        permit.issued = true
        authority = false
        XCTAssertFalse(permit.authorizeHandoff(), "The queued continuation cannot cross revocation")
        authority = true
        XCTAssertFalse(permit.authorizeHandoff(), "An expired permit cannot be revived")
        XCTAssertTrue(permit.issued)
        XCTAssertNil(LiveQueuedToolPermit(current: { false }).prepare(frames))

        var invalid = frames
        invalid[0]["type"] = "conversation.item.create"
        XCTAssertNil(LiveQueuedToolPermit(current: { true }).prepare(invalid))
        var duplicate = frames
        duplicate.insert(frames[0], at: 1)
        XCTAssertNil(LiveQueuedToolPermit(current: { true }).prepare(duplicate))
        XCTAssertNil(LiveQueuedToolPermit(current: { true }).prepare(Array(frames.prefix(1))))

        verifyAQueuedResultCannotSubmitAfterExactSourceRetirement()
        verifyOutputDoesNotAcknowledgeUntilTheExactContinuationSubmits()
        verifyClearingAfterFirstSubmissionSuppressesContinuation()
        verifyDeadlineRejectsBothUnissuedAndPartiallySubmittedStalledQueues()
        verifyLastHopRejectsElapsedDeadlineBeforeItsMainQueueCallbackRuns()
    }

    func testManagedToolPortCannotBorrowAnotherLiveCallEpochOrResumeStaleQueue() throws {
        let socket = HeldManagedSocket()
        let owner = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        let call = RealtimeVoiceCall(audio: Audio(), socket: socket, ownership: owner,
                                     permission: { _ in XCTFail("No microphone permission") },
                                     foreground: { true }, emit: { _, _ in })
        let epoch = UUID()
        let token = try owner.reserve()
        defer { try? owner.release(token) }
        call.token = token
        call.ready = true
        call.id = "current-call"
        call.liveSessionID = "current-session"
        call.liveSocketEpoch = epoch
        call.liveExpiresAt = Date().addingTimeInterval(30)
        let frames = syntheticManagedToolFrames()
        func enqueue(_ callID: String, _ sessionID: String, _ socketEpoch: UUID) -> Bool {
            call.enqueueManagedToolFrames(frames, callID: callID, sessionID: sessionID,
                                          socketEpoch: socketEpoch, approvedCurrent: { true })
        }
        XCTAssertFalse(enqueue("other-call", "current-session", epoch))
        XCTAssertFalse(enqueue("current-call", "other-session", epoch))
        XCTAssertFalse(enqueue("current-call", "current-session", UUID()))
        XCTAssertTrue(enqueue("current-call", "current-session", epoch))
        XCTAssertTrue(socket.held?.authorizeHandoff() ?? false)
        call.paused = true
        XCTAssertFalse(socket.held?.authorizeHandoff() ?? true)
        call.paused = false
        XCTAssertFalse(socket.held?.authorizeHandoff() ?? true)
    }

    private func syntheticManagedToolFrames() -> [[String: Any]] {
        [
            ["type": "response.item.create", "event_id": UUID().uuidString,
             "item": ["type": "function_call_output", "call_id": "fixture-call", "output": "synthetic"]],
            ["type": "response.create", "event_id": UUID().uuidString],
        ]
    }
}

private final class HeldManagedSocket: RealtimeSocketPort {
    var received: (([String: Any]) -> Void)?
    var failed: (() -> Void)?
    var held: LiveQueuedToolPermit?

    func open(model _: String, key _: String) {
        XCTFail("No provider connection")
    }

    func send(_: [String: Any]) {
        XCTFail("No generic output")
    }

    func discardInput() {}
    func close() {}
    func sendManagedToolFrames(_ frames: [[String: Any]], current: @escaping () -> Bool) -> Bool {
        let permit = LiveQueuedToolPermit(current: current)
        guard permit.prepare(frames) != nil else { return false }
        held = permit
        return true
    }
}
