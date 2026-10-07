@testable import OpenAIProvider
import XCTest

final class ChatGPTRequestLifecycleGateTests: XCTestCase {
    func testSignOutClaimsAQueuedTerminalTicketAndSuppressesItsCompletion() throws {
        let gate = ChatGPTRequestLifecycleGate()
        let ticket = try acceptedTicket(gate)
        var delivered = [String]()
        let queuedDelta = {
            gate.deliver(ticket, terminal: false) { delivered.append("delta") }
        }
        XCTAssertTrue(gate.reserveTerminal(ticket))

        let cancelled = try XCTUnwrap(gate.beginSignOut(for: ticket.issuedClientID))
        XCTAssertEqual(cancelled.map(\.id), [ticket.id])
        XCTAssertFalse(queuedDelta())
        XCTAssertFalse(gate.deliver(ticket, terminal: true) { delivered.append("completed") })

        XCTAssertTrue(delivered.isEmpty)
    }

    func testQueuedDeltaIsDeliveredBeforeReservedTerminalPacket() throws {
        let gate = ChatGPTRequestLifecycleGate()
        let ticket = try acceptedTicket(gate)
        var delivered = [String]()
        // Model an earlier main-queue callback draining after the stream reserves completion.
        let queuedDelta = {
            gate.deliver(ticket, terminal: false) { delivered.append("delta") }
        }

        XCTAssertTrue(gate.reserveTerminal(ticket))
        XCTAssertTrue(queuedDelta())
        XCTAssertTrue(gate.deliver(ticket, terminal: true) { delivered.append("completed") })

        XCTAssertEqual(delivered, ["delta", "completed"])
    }

    func testDeliveredTerminalWinsBeforeLaterSignOut() throws {
        let gate = ChatGPTRequestLifecycleGate()
        let ticket = try acceptedTicket(gate)
        XCTAssertTrue(gate.reserveTerminal(ticket))
        var delivered = [String]()

        XCTAssertTrue(gate.deliver(ticket, terminal: true) { delivered.append("completed") })
        XCTAssertEqual(gate.beginSignOut(for: ticket.issuedClientID)?.count, 0)

        XCTAssertEqual(delivered, ["completed"])
    }

    private func acceptedTicket(_ gate: ChatGPTRequestLifecycleGate) throws -> ChatGPTRequestLifecycleGate.Ticket {
        guard case let .accepted(ticket) = gate.register("request-1", issuedClientID: "account-1") else {
            throw GateTestError.registrationFailed
        }
        return ticket
    }
}

private enum GateTestError: Error {
    case registrationFailed
}
