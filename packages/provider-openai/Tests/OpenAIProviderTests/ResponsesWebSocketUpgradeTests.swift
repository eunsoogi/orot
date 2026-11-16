import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesWebSocketUpgradeTests: XCTestCase {
    func testOnlyExplicitUnsupportedUpgradeIsEligibleBeforeOpen() async throws {
        for status in [404, 405, 426, 501] {
            let gate = ResponsesWebSocketUpgradeGate()
            gate.failed(httpStatus: status)
            do { try await gate.wait(); XCTFail("Upgrade should fail") }
            catch ResponsesWebSocketUpgradeError.rejectedBeforeRequest {}
            catch { XCTFail("Expected definitive upgrade refusal") }
        }
    }

    func testAmbiguousAuthenticationThrottlingAndServerFailuresDoNotAuthorizeReplay() async throws {
        for status: Int? in [nil, 101, 200, 301, 400, 401, 403, 408, 429, 500, 502, 503] {
            let gate = ResponsesWebSocketUpgradeGate()
            gate.failed(httpStatus: status)
            do { try await gate.wait(); XCTFail("Upgrade should fail") }
            catch ResponsesWebSocketUpgradeError.rejectedBeforeRequest { XCTFail("Unsafe replay authorization") }
            catch {}
        }
    }

    func testOpenedConnectionCanNeverBecomeAnUpgradeRefusal() async throws {
        let gate = ResponsesWebSocketUpgradeGate()
        gate.opened()
        gate.failed(httpStatus: 404)
        try await gate.wait()
    }

    func testCancellationWinsBeforeLateUpgradeFailure() async throws {
        let gate = ResponsesWebSocketUpgradeGate()
        gate.cancelled()
        gate.failed(httpStatus: 426)
        do { try await gate.wait(); XCTFail("Cancelled gate must fail") }
        catch is CancellationError {}
        catch { XCTFail("Cancellation must not become retry eligibility") }
    }

    func testWaitingGateResumesExactlyOnce() async throws {
        let gate = ResponsesWebSocketUpgradeGate()
        let pending = Task { try await gate.wait() }
        await Task.yield()
        gate.opened()
        gate.opened()
        gate.failed(httpStatus: 501)
        try await pending.value
    }
}
