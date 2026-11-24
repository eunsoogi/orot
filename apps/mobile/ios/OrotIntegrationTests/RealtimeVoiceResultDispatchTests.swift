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

extension RealtimeVoiceLifecycleTests {
    func verifyObservedCallCaptionsRequireTheExactCorrelatedClose() {
        let owned = LiveObservedCaptionBuffer.Owner(call: "live-1-1", session: "session", epoch: UUID())
        let replaced = LiveObservedCaptionBuffer.Owner(call: "live-1-2", session: "session", epoch: UUID())
        var buffer = LiveObservedCaptionBuffer()
        buffer.append(["type": "session.input_transcript.delta", "event_id": "first", "delta": "test input"], owner: owned)
        buffer.append(["type": "session.output_transcript.delta", "event_id": "foreign", "delta": "foreign"], owner: replaced)
        buffer.append(["type": "session.output_transcript.delta", "event_id": "first", "delta": "duplicate"], owner: owned)
        buffer.append(["type": "session.output_transcript.delta", "event_id": "second", "delta": "test output"], owner: owned)
        let saved = buffer.take(owned)
        XCTAssertEqual(saved?["status"] as? String, "observed_incomplete")
        XCTAssertEqual((saved?["lines"] as? [[String: Any]])?.compactMap { $0["role"] as? String }, ["user", "assistant"])
        XCTAssertNil(buffer.take(owned))
        var close: [String: Any] = [
            "type": "session.closed", "event_id": "closed", "client_event_id": "expected",
            "reason": "close_requested", "session": ["id": owned.session, "model": "gpt-live-1.1"],
        ]
        XCTAssertTrue(LiveObservedCaptionBuffer.acknowledged(close, sessionID: owned.session, command: "expected"))
        XCTAssertFalse(LiveObservedCaptionBuffer.acknowledged(close, sessionID: "replaced", command: "expected"))
        close.removeValue(forKey: "client_event_id")
        XCTAssertFalse(LiveObservedCaptionBuffer.acknowledged(close, sessionID: owned.session, command: "expected"))
    }

    func verifyManagedCaptionCloseDropsUnsentFramesAndRejectsPartialToolWrites() throws {
        let authority = LiveNativeResultDispatchAuthority()
        let ticket = authority.begin(call: "call", challenge: "challenge")
        XCTAssertTrue(ticket.claim())
        XCTAssertTrue(ticket.bind { _ in })
        let permit = LiveQueuedToolPermit(current: { true }, ticket: ticket)
        let sending = RealtimeSocketWrite(text: "already handed", isInput: true)
        let protected = RealtimeSocketWrite(text: "queued protected", isInput: false, permit: permit)
        let queued = RealtimeSocketWrite(text: "queued ordinary", isInput: true)
        XCTAssertNil(LiveCaptionTerminalQueue.prepare([protected, queued], sending: true))
        permit.issued = true
        XCTAssertNil(LiveCaptionTerminalQueue.prepare([sending, protected], sending: true))
        permit.issued = false
        let prepared = try XCTUnwrap(LiveCaptionTerminalQueue.prepare([sending, protected, queued], sending: true))
        XCTAssertEqual(prepared.retained.map(\.text), [sending.text])
        prepared.retireDiscarded()
        XCTAssertFalse(ticket.submit { XCTFail("A retired ticket must not submit") })
    }
}
