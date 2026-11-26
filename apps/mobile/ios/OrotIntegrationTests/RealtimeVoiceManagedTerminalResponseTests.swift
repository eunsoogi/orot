import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    func testManagedTerminalFailureOnlyRetiresItsExactResponse() async throws {
        for status in ["failed", "incomplete"] {
            for scope in ["exact", "foreign-response", "foreign-delegation", "missing-response", "wrong-status"] {
                let socket = ManagedResponseFixtureSocket()
                let configured = expectation(description: "configured Live fixture")
                let queued = expectation(description: "continued only for \(status) \(scope)")
                queued.isInverted = scope == "exact"
                socket.configured = { configured.fulfill() }
                socket.queued = { queued.fulfill() }
                let call = managedFixtureCall(socket)
                var executed: [String] = []
                let admission = managedAdmission { request, finish in
                    executed.append(request.functionID)
                    finish(#"{"status":"synthetic"}"#)
                    return {}
                }
                call.open("fixture-call", model: "gpt-live-1.1", key: "synthetic-key", language: "auto",
                          managedAdmission: admission) { _ in }
                await fulfillment(of: [configured], timeout: 2)
                socket.received?(started())
                let events = managedEvents()
                for event in events.dropLast() {
                    socket.received?(event)
                }
                var terminal: [String: Any] = ["type": "response.\(status)"]
                if scope != "missing-response" {
                    terminal["response"] = [
                        "id": scope == "foreign-response" ? "response-b" : "response-a",
                        "status": scope == "wrong-status" ? "in_progress" : status,
                    ]
                }
                socket.received?(["type": "response.event", "event_id": "terminal-event",
                                  "delegation_id": scope == "foreign-delegation" ? "delegation-b" : "delegation-a",
                                  "event": terminal])
                let completed = try XCTUnwrap(events.last)
                socket.received?(completed)
                if scope == "exact" {
                    // The real bridge queues approval/execution on the main queue;
                    // an inverted expectation also catches a belated result handoff.
                    await fulfillment(of: [queued], timeout: 0.2)
                    XCTAssertTrue(executed.isEmpty)
                    XCTAssertTrue(socket.managed.isEmpty)
                } else {
                    await fulfillment(of: [queued], timeout: 2)
                    XCTAssertEqual(executed, ["function-a"])
                    XCTAssertEqual(socket.managed.map { $0["type"] as? String }, ["response.item.create", "response.create"])
                }
                try call.stop("fixture-call")
            }
        }
        try await assertOwnedAuthorizationQueueTiming()
    }

    /// The fake admission completes only when released. Keep the actual main
    /// queue hop, then prove that retired, denied, and duplicate callbacks do not sample.
    private func assertOwnedAuthorizationQueueTiming() async throws {
        for mode in ["owned", "retired", "replaced", "denied"] {
            var ownerCurrent = true
            var approval: ((Bool) -> Void)?
            var observed: [LiveManagedToolLatency] = []
            var executed = 0
            var frames = 0
            var admission = LiveResponsesAdmission(
                backendModel: "gpt-6-luna", functionName: "orot_reviewed_memory",
                backendAllowed: { true }, mayRun: { $0.owner.callID == "fixture-call" },
                approve: { _, complete in
                    approval = complete
                    return {}
                },
                execute: { _, _ in
                    executed += 1
                    return {}
                },
                mayDisclose: { _, _ in false }
            )
            admission.observeTiming = { stage, duration in
                observed.append(stage)
                XCTAssertLessThanOrEqual(duration, 300_000)
            }
            let bridge = try LiveResponsesToolBridge(
                admission: admission, registry: XCTUnwrap(LiveNativeToolRegistry(admission: admission)),
                discard: {}
            )
            let owner = LiveResponsesAdmission.Owner(callID: "fixture-call", sessionID: "fixture-session", epoch: UUID())
            for event in managedEvents() {
                bridge.receive(event, owner: owner, current: { ownerCurrent }) { _, _, _ in frames += 1 }
            }
            let callback = try XCTUnwrap(approval)
            XCTAssertTrue(observed.isEmpty)
            callback(mode != "denied")
            callback(true)
            if mode == "retired" {
                bridge.retire()
            } else if mode == "replaced" {
                ownerCurrent = false
            }
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                DispatchQueue.main.async { continuation.resume() }
            }
            XCTAssertEqual(executed, mode == "owned" ? 1 : 0)
            XCTAssertEqual(observed, mode == "owned" ? [.authorizationQueue, .terminalToOwnedTool] : [])
            XCTAssertEqual(frames, 0)
            bridge.retire()
        }
    }
}

extension RealtimeVoiceLifecycleTests {
    @MainActor
    func testCommonV3ProductionAdmissionPinsOwnedTerminalProjection() async throws {
        let witness = LiveConversationToolsSettingsWitness(backendModel: "gpt-6-luna", credentialEpoch: "synthetic",
                                                           generation: "generation", grantID: "generation-model", voiceGeneration: "voice")
        let owner = LiveResponsesAdmission.Owner(callID: "fixture-call", sessionID: "fixture-session", epoch: UUID())
        let pins = LiveCommonV3SourcePins()
        var bridge: LiveResponsesToolBridge?
        let factory = try XCTUnwrap(LiveCanonicalContextV3Transport(call: owner.callID,
                                                                    requested: LiveCanonicalContextV3Transport.registration(witness), witness: { witness },
                                                                    startupCurrent: { $0 == owner.callID }, owns: { $0 == owner },
                                                                    ownsRequest: { bridge?.ownsCompleted($0) == true }, sourceTicketCurrent: pins.matches))
        defer { bridge?.retire(); factory.retire() }
        let called = expectation(description: "exact finished function")
        var batch: [String: Any]?
        let admission = factory.bridge(pins: pins) { event, body in
            guard event == "VoiceRealtimeCommonToolBatch" else { return }
            batch = body
            called.fulfill()
        }
        let registry = try XCTUnwrap(LiveNativeToolRegistry(admission: admission))
        XCTAssertNotNil(registry.configuration(for: admission))
        XCTAssertNotNil(factory.acknowledge(owner))
        bridge = LiveResponsesToolBridge(admission: admission, registry: registry, discard: {})
        let output = #"{"tool":"local-health-context","items":[{"evidenceId":"fixture","evidenceRevision":"1","content":"Synthetic"}]}"#
        let queued = expectation(description: "ticketed exact output and continuation")
        var wire: [[String: Any]] = []
        var currentWire: (() -> Bool)?
        var ticket: LiveNativeResultDispatchAuthority.Ticket?
        func send(_ event: [String: Any]) {
            bridge?.receive(event, owner: owner, current: { true }) { out, current, receivedTicket in
                wire = out; currentWire = current; ticket = receivedTicket
                queued.fulfill()
            }
        }
        let events = managedEvents().map { envelope -> [String: Any] in
            var outer = envelope
            guard var event = outer["event"] as? [String: Any], var item = event["item"] as? [String: Any] else { return outer }
            item["name"] = "local-health-context"; item["arguments"] = "{}"
            event["item"] = item; outer["event"] = event
            return outer
        }
        events.dropLast().forEach(send)
        XCTAssertNil(batch)
        try send(XCTUnwrap(events.last))
        await fulfillment(of: [called], timeout: 1)
        let item = try XCTUnwrap((batch?["calls"] as? [[String: String]])?.first)
        let challenge = try XCTUnwrap(item["challengeId"])
        XCTAssertTrue(pins.isCurrent(call: owner.callID, session: owner.sessionID, delegation: "delegation-a",
                                     response: "response-a", challenge: challenge, function: "function-a"))
        XCTAssertFalse(pins.claim("other-call", challenge, output))
        XCTAssertTrue(pins.claim(owner.callID, challenge, output))
        XCTAssertFalse(pins.claim(owner.callID, challenge, output + " "))
        let retired = expectation(description: "only the independent source retirement settles false")
        factory.settleBridge(callId: owner.callID, challenge: challenge, exact: output) {
            XCTAssertFalse($0)
            retired.fulfill()
        }
        await fulfillment(of: [queued], timeout: 1)
        XCTAssertEqual(wire.compactMap { $0["type"] as? String }, ["response.item.create", "response.create"])
        XCTAssertEqual((wire.first?["item"] as? [String: Any])?["output"] as? String, output)
        XCTAssertEqual(currentWire?(), true)
        pins.retire(call: owner.callID, challenge: challenge)
        XCTAssertEqual(currentWire?(), false)
        XCTAssertFalse(try XCTUnwrap(ticket).submit { XCTFail("Retired source cannot reach socket.") })
        await fulfillment(of: [retired], timeout: 1)
    }
}
