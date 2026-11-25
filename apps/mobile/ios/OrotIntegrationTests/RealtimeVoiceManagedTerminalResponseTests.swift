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
    }
}
