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
                mayDisclose: { _, _ in false },
            )
            admission.observeTiming = { stage, duration in
                observed.append(stage)
                XCTAssertLessThanOrEqual(duration, 300_000)
            }
            let bridge = try LiveResponsesToolBridge(
                admission: admission, registry: XCTUnwrap(LiveNativeToolRegistry(admission: admission)),
                discard: {},
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
