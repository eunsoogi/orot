import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    private struct Fixture {
        let old = String(repeating: "a", count: 64)
        let next = String(repeating: "b", count: 64)
        let credential = String(repeating: "c", count: 64)
        let key = "synthetic-test-only"
        var baseline: LiveResponsesSettingsGrant {
            LiveResponsesSettingsGrant(["backendModel": "gpt-6-sol", "generation": old, "grantID": old + "-model"])!
        }

        var options: [String: Any] {
            [
                "version": 2, "capability": "canonical-health-context-result-v2",
                "backendModel": "gpt-6-sol", "generation": next, "grantID": next + "-model",
                "legacyGeneration": old, "credentialEpoch": credential,
            ]
        }

        func read(_ service: String, _: String) -> [String: Any]? {
            switch service {
            case "com.orot.mobile.settings-consent-authority.v1.voice-responses":
                ["version": 1, "status": "active", "generation": old]
            case "com.orot.mobile.settings-consent-authority.v1.voice-responses-health-context":
                ["version": 1, "status": "active", "generation": next]
            case "com.orot.mobile.voice-settings.v1":
                ["apiKey": key, "credentialEpoch": credential, "mode": "openai-api", "model": "gpt-live-1.1"]
            case "com.orot.mobile.live-responses-settings.v1":
                ["version": 1, "backendModel": "gpt-6-sol", "grantID": old + "-model", "generation": old, "credentialEpoch": credential]
            case "com.orot.mobile.live-health-context.v2":
                options
            default:
                nil
            }
        }
    }

    func assertOnlyOwnedCanonicalTicketAcceptsTheApprovedBoundedResultAndContinuation() throws {
        let fixture = Fixture()
        let admission = try XCTUnwrap(RealtimeVoiceCanonicalHealthAdmission(fixture.options))
        let authority = LiveNativeResultDispatchAuthority()
        let request = RealtimeVoiceCanonicalHealthMailbox.Request(
            call: "call", session: "session", epoch: UUID(), response: "response", delegation: "delegation",
            function: "function", rawArguments: #"{"days":7,"topics":["measurements"]}"#,
        )
        var owner = true
        var challenge: String?
        var sentArgs: String?
        let mailbox = RealtimeVoiceCanonicalHealthMailbox(
            call: request.call, baseline: fixture.baseline, capability: admission,
            authority: authority, key: fixture.key, read: fixture.read,
            owns: { owner && $0 == request }, emit: { _, payload in
                challenge = payload["challengeId"] as? String
                sentArgs = payload["args"] as? String
            },
        )
        var response: String?
        _ = mailbox.begin(request) { response = $0 }
        let ticketID = try XCTUnwrap(challenge)
        XCTAssertEqual(sentArgs, request.rawArguments)
        XCTAssertTrue(authority.claim(call: request.call, challenge: ticketID))
        let content = String(repeating: "x", count: 2400)
        let output = #"{"tool":"local-health-context","items":[{"evidenceId":"issued","evidenceRevision":"current","content":""# + content + #""}]}"#
        var settled: [Bool] = []
        let denied = expectation(description: "same call retired after output before continuation")
        mailbox.settle(ticketID, output: output) {
            settled.append($0)
            denied.fulfill()
        }
        XCTAssertEqual(response, output)
        XCTAssertNil(mailbox.dispatchTicket(for: request, exact: output + " "))
        let canonical = try XCTUnwrap(mailbox.dispatchTicket(for: request, exact: output))
        let frames: [[String: Any]] = [
            ["type": "response.item.create", "event_id": UUID().uuidString,
             "item": ["type": "function_call_output", "call_id": request.function, "output": output]],
            ["type": "response.create", "event_id": UUID().uuidString],
        ]
        XCTAssertNil(LiveQueuedToolPermit(current: { true }).prepare(frames))
        let permit = LiveQueuedToolPermit(current: {
            mailbox.dispatchTicket(for: request, exact: output) === canonical
        }, ticket: canonical)
        XCTAssertEqual(permit.prepare(frames)?.count, 2)
        XCTAssertTrue(canonical.submit {})
        XCTAssertEqual(settled, [])
        owner = false
        XCTAssertFalse(permit.authorizeHandoff())
        canonical.retire()
        owner = true
        XCTAssertFalse(permit.authorizeHandoff())
        XCTAssertFalse(canonical.submit { XCTFail("retired continuation submitted") })
        wait(for: [denied], timeout: 1)
        XCTAssertEqual(settled, [false])
        _ = mailbox.begin(request) { XCTAssertNil($0) }
        #if OROT_TESTS && targetEnvironment(simulator)
            try assertCanonicalResultUsesActualSocketQueue()
        #endif
    }
}

#if OROT_TESTS && targetEnvironment(simulator)
    extension RealtimeVoiceLifecycleTests {
        private func assertCanonicalResultUsesActualSocketQueue() throws {
            for disposition in ["allow", "revoked", "replaced"] {
                let fixture = Fixture()
                let companion = try XCTUnwrap(RealtimeVoiceCanonicalHealthAdmission(fixture.options))
                let authority = LiveNativeResultDispatchAuthority()
                let original = NetworklessLiveSocketTask(), successor = NetworklessLiveSocketTask()
                var taskCount = 0, owned = true
                let endpoint = RealtimeVoiceSocketEndpoint(networklessTask: {
                    taskCount += 1
                    return taskCount == 1 ? original : successor
                })
                let socket = RealtimeVoiceSocket(endpoint: endpoint)
                defer { socket.close() }
                let request = RealtimeVoiceCanonicalHealthMailbox.Request(
                    call: "call", session: "session", epoch: UUID(), response: "response",
                    delegation: "delegation", function: "function", rawArguments: #"{"days":7}"#,
                )
                var challenge: String?, response: String?
                let mailbox = RealtimeVoiceCanonicalHealthMailbox(
                    call: request.call, baseline: fixture.baseline, capability: companion,
                    authority: authority, key: fixture.key, read: fixture.read,
                    owns: { owned && $0 == request }, emit: { _, body in challenge = body["challengeId"] as? String },
                )
                socket.open(model: "gpt-live-1.1", key: fixture.key)
                XCTAssertEqual(original.resumes, 1)
                _ = mailbox.begin(request) { response = $0 }
                let challengeID = try XCTUnwrap(challenge)
                XCTAssertTrue(authority.claim(call: request.call, challenge: challengeID))
                let exact = #"{"tool":"local-health-context","items":[{"evidenceId":"source","evidenceRevision":"one","content":"synthetic"}]}"#
                let settled = expectation(description: disposition)
                var ack: [Bool] = []
                mailbox.settle(challengeID, output: exact) { value in ack.append(value); settled.fulfill() }
                XCTAssertEqual(response, exact)
                let ticket = try XCTUnwrap(mailbox.dispatchTicket(for: request, exact: exact))
                let frames: [[String: Any]] = [
                    ["type": "response.item.create", "event_id": "output",
                     "item": ["type": "function_call_output", "call_id": request.function, "output": exact]],
                    ["type": "response.create", "event_id": "continuation"],
                ]
                XCTAssertTrue(socket.sendTicketedToolFrames(frames, current: {
                    mailbox.dispatchTicket(for: request, exact: exact) === ticket
                }, ticket: ticket))
                XCTAssertEqual(original.messages.count, 1)
                let output = try XCTUnwrap(original.messages.first)
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any])
                XCTAssertEqual(json["type"] as? String, "response.item.create")
                XCTAssertEqual((json["item"] as? [String: String])?["output"], exact)
                XCTAssertEqual(ack, [])
                if disposition == "revoked" {
                    owned = false
                    mailbox.revoke()
                } else if disposition == "replaced" {
                    socket.close()
                    socket.open(model: "gpt-live-1.1", key: fixture.key)
                }
                original.completeFirst()
                wait(for: [settled], timeout: 1)
                XCTAssertEqual(ack, [disposition == "allow"])
                XCTAssertEqual(original.messages.count, disposition == "allow" ? 2 : 1)
                if disposition == "allow" {
                    let second = try XCTUnwrap(original.messages.last)
                    let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(second.utf8)) as? [String: String])
                    XCTAssertEqual(value["type"], "response.create")
                }
                XCTAssertTrue(successor.messages.isEmpty)
            }
        }
    }

    private final class NetworklessLiveSocketTask: RealtimeVoiceSocketTask {
        var resumes = 0
        var messages: [String] = []
        var completions: [@Sendable (Error?) -> Void] = []

        func resume() {
            resumes += 1
        }

        func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping @Sendable (Error?) -> Void) {
            guard case let .string(payload) = message else { XCTFail("Unexpected nontext frame"); return }
            messages.append(payload)
            completions.append(completionHandler)
        }

        func receive(completionHandler _: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {}
        func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {}
        func completeFirst() {
            completions.removeFirst()(nil)
        }
    }
#endif
