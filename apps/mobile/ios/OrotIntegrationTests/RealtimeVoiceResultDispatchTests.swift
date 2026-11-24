import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    func verifyAQueuedResultCannotSubmitAfterExactSourceRetirement() {
        let authority = LiveNativeResultDispatchAuthority()
        let ticket = authority.begin(call: "call", challenge: "challenge")
        XCTAssertFalse(authority.claim(call: "other", challenge: "challenge"))
        XCTAssertTrue(authority.claim(call: "call", challenge: "challenge"))
        XCTAssertFalse(authority.claim(call: "call", challenge: "challenge"))
        let denied = expectation(description: "retired completion")
        XCTAssertTrue(ticket.bind { success in XCTAssertFalse(success); denied.fulfill() })
        XCTAssertTrue(authority.retire(call: "call", challenge: "challenge"))
        XCTAssertFalse(ticket.submit { XCTFail("stale result must not reach native send") })
        wait(for: [denied], timeout: 1)
    }

    func verifyOutputDoesNotAcknowledgeUntilTheExactContinuationSubmits() {
        let authority = LiveNativeResultDispatchAuthority()
        let old = authority.begin(call: "call", challenge: "old")
        XCTAssertTrue(authority.claim(call: "call", challenge: "old"))
        let replacement = authority.begin(call: "call", challenge: "new")
        XCTAssertFalse(old.submit { XCTFail("replaced result submitted") })
        XCTAssertTrue(authority.retire(call: "call", challenge: "old"))
        XCTAssertTrue(authority.claim(call: "call", challenge: "new"))
        var terminal: [Bool] = []
        XCTAssertTrue(replacement.bind { terminal.append($0) })
        var submissions: [String] = []
        XCTAssertTrue(replacement.submit { submissions.append("output") })
        XCTAssertTrue(terminal.isEmpty)
        XCTAssertTrue(replacement.submit { submissions.append("continuation") })
        XCTAssertEqual(submissions, ["output", "continuation"])
        XCTAssertEqual(terminal, [true])
        XCTAssertFalse(replacement.submit { XCTFail("duplicate continuation submitted") })
    }

    func verifyClearingAfterFirstSubmissionSuppressesContinuation() {
        let authority = LiveNativeResultDispatchAuthority()
        let ticket = authority.begin(call: "call", challenge: "challenge")
        XCTAssertTrue(authority.claim(call: "call", challenge: "challenge"))
        let denied = expectation(description: "partial dispatch retired")
        XCTAssertTrue(ticket.bind { success in XCTAssertFalse(success); denied.fulfill() })
        XCTAssertTrue(ticket.submit {})
        XCTAssertTrue(authority.retire(call: "call", challenge: "challenge"))
        XCTAssertFalse(ticket.submit { XCTFail("stale continuation submitted") })
        wait(for: [denied], timeout: 1)
    }

    func verifyDeadlineRejectsBothUnissuedAndPartiallySubmittedStalledQueues() {
        for partial in [false, true] {
            let authority = LiveNativeResultDispatchAuthority()
            let ticket = authority.begin(call: "call", challenge: "deadline")
            XCTAssertTrue(authority.claim(call: "call", challenge: "deadline"))
            let notifiedQueue = expectation(description: "exact queue retired")
            let terminal = expectation(description: "one denied acknowledgement")
            var terminalCount = 0
            XCTAssertTrue(ticket.bind(timeout: .milliseconds(10)) { success in
                terminalCount += 1
                XCTAssertFalse(success)
                terminal.fulfill()
            })
            XCTAssertTrue(ticket.observeQueueRetirement { hadOutput in
                XCTAssertEqual(hadOutput, partial)
                notifiedQueue.fulfill()
            })
            if partial {
                XCTAssertTrue(ticket.submit {})
            }
            wait(for: [notifiedQueue, terminal], timeout: 1)
            ticket.retire()
            XCTAssertFalse(ticket.submit { XCTFail("expired work must not replay") })
            XCTAssertEqual(terminalCount, 1)
        }
    }

    func verifyLastHopRejectsElapsedDeadlineBeforeItsMainQueueCallbackRuns() {
        let authority = LiveNativeResultDispatchAuthority()
        let ticket = authority.begin(call: "call", challenge: "elapsed")
        XCTAssertTrue(authority.claim(call: "call", challenge: "elapsed"))
        let terminal = expectation(description: "expired before scheduling can run")
        XCTAssertTrue(ticket.bind(timeout: .nanoseconds(0)) { success in
            XCTAssertFalse(success)
            terminal.fulfill()
        })
        XCTAssertFalse(ticket.submit { XCTFail("elapsed deadline must win at last hop") })
        wait(for: [terminal], timeout: 1)
    }
}
