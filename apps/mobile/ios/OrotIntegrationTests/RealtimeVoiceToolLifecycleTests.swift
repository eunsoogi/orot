import Foundation
@testable import Orot
import XCTest

/// Real native coordinator, fake audio/socket/permissions. No provider request or record data is used.
extension RealtimeVoiceLifecycleTests {
    func testDelegationIsOptInAndWaitsForCompletedResponse() async throws {
        let plain = RealtimeVoiceCall.configuration(model: "gpt-realtime-2.1", language: "ko-KR")
        XCTAssertNil((plain["session"] as? [String: Any])?["tools"])
        let f = ToolFixture()
        f.call.open("bad id", model: "gpt-realtime-2.1", key: "synthetic", language: "ko-KR", enableTools: true) { _ in }
        XCTAssertNil(f.call.token)
        let unclaimed = try f.call.ownership.reserve()
        try f.call.ownership.release(unclaimed)
        await openTools(f)
        XCTAssertEqual(((f.socket.sent.first?["session"] as? [String: Any])?["tools"] as? [[String: Any]])?.count, 1)
        f.request()
        XCTAssertTrue(f.requests.isEmpty)
        f.complete()
        XCTAssertEqual(f.requests.count, 1)
        XCTAssertEqual(f.requests.first?["inputItemId"] as? String, "input_1")
        XCTAssertNil(f.requests.first?["arguments"])
        try f.call.stop("call")
    }

    func testDelegationRejectsArgumentsIDsAndNonCompletedResponses() async throws {
        for args in ["", "[]", "{\"recordId\":\"synthetic\"}", "null"] {
            let f = ToolFixture(); await openTools(f)
            f.request(arguments: args); f.complete()
            XCTAssertTrue(f.requests.isEmpty)
            try f.call.stop("call")
        }
        for status in ["cancelled", "incomplete", "failed"] {
            let f = ToolFixture(); await openTools(f)
            f.request(); f.complete(status)
            XCTAssertTrue(f.requests.isEmpty)
            try f.call.stop("call")
        }
        XCTAssertFalse(RealtimeVoiceToolLease.validID("bad id"))
        XCTAssertFalse(RealtimeVoiceToolLease.validID(String(repeating: "a", count: 129)))
        XCTAssertFalse(RealtimeVoiceToolLease.validID("한글"))
    }

    func testDelegationReplyIsOwnedBoundedAndOneShot() async throws {
        let f = ToolFixture(); await openTools(f)
        f.request(arguments: " { } "); f.complete()
        XCTAssertFalse(f.call.resolveTool("other", toolCallID: "tool_1", responseID: "response_1", output: "approved"))
        XCTAssertFalse(f.call.resolveTool("call", toolCallID: "tool_1", responseID: "other", output: "approved"))
        XCTAssertFalse(f.call.resolveTool("call", toolCallID: "tool_1", responseID: "response_1", output: String(repeating: "가", count: 6000)))
        let before = f.socket.sent.count
        XCTAssertTrue(f.call.resolveTool("call", toolCallID: "tool_1", responseID: "response_1", output: "synthetic approved output"))
        XCTAssertEqual(f.socket.sent.count, before + 2)
        XCTAssertEqual((f.socket.sent[before]["item"] as? [String: Any])?["type"] as? String, "function_call_output")
        XCTAssertEqual(f.socket.sent.last?["type"] as? String, "response.create")
        XCTAssertFalse(f.call.resolveTool("call", toolCallID: "tool_1", responseID: "response_1", output: "duplicate"))
        try f.call.stop("call")
        let background = ToolFixture(); await openTools(background)
        background.request(); background.complete(); background.foreground = false
        let untouched = background.socket.sent.count
        XCTAssertFalse(background.call.resolveTool("call", toolCallID: "tool_1", responseID: "response_1", output: "not in background"))
        background.foreground = true
        XCTAssertFalse(background.call.resolveTool("call", toolCallID: "tool_1", responseID: "response_1", output: "not after foreground return"))
        XCTAssertEqual(background.socket.sent.count, untouched)
        try background.call.stop("call")
    }

    func testDelegationNewSpeechMuteStopAndResponseCancelLateReplies() async throws {
        for boundary in ["speech", "mute", "stop", "response", "commit", "revoke"] {
            let f = ToolFixture(); await openTools(f)
            f.request(); f.complete()
            switch boundary {
            case "speech": f.socket.received?(["type": "input_audio_buffer.speech_started"])
            case "mute": try f.call.pause("call")
            case "stop": try f.call.stop("call")
            case "revoke": f.call.cancelTools()
            case "commit": f.socket.received?(["type": "input_audio_buffer.committed", "item_id": "next_input"])
            default: f.socket.received?(["type": "response.created", "response": ["id": "next_response"]])
            }
            XCTAssertEqual(f.cancelled.count, 1)
            XCTAssertFalse(f.call.resolveTool("call", toolCallID: "tool_1", responseID: "response_1", output: "late"))
            try f.call.stop("call")
        }
    }

    func testDelegationRejectsReplaysAndAmbiguousInputEpochs() async throws {
        let f = ToolFixture(); await openTools(f)
        f.request(); f.complete(); f.request(); f.complete()
        XCTAssertEqual(f.requests.count, 1)
        XCTAssertFalse(f.call.resolveTool("call", toolCallID: "tool_1", responseID: "response_1", output: "cancelled by replay"))
        try f.call.stop("call")
        let lease = RealtimeVoiceToolLease(); lease.reset(enabled: true)
        lease.commit("input_a"); lease.invalidate(); lease.commit("input_b"); lease.bind("late_response")
        lease.receive(responseID: "late_response", toolCallID: "tool", name: "orot_conversation", arguments: "{}")
        XCTAssertNil(lease.complete("late_response", successful: true))
        XCTAssertFalse(lease.enabled)
    }

    func testDelegationBudgetDoesNotEvictTombstones() {
        let lease = RealtimeVoiceToolLease(); lease.reset(enabled: true)
        for index in 0 ... 64 {
            lease.commit("input_\(index)"); lease.bind("response_\(index)")
            lease.receive(responseID: "response_\(index)", toolCallID: "tool_\(index)", name: "orot_conversation", arguments: "{}")
            let request = lease.complete("response_\(index)", successful: true)
            XCTAssertEqual(request != nil, index < 64)
            lease.invalidate()
        }
        XCTAssertFalse(lease.enabled)
    }

    private func openTools(_ f: ToolFixture) async {
        let opened = expectation(description: "synthetic socket opened")
        f.socket.opened = { opened.fulfill() }
        f.call.open("call", model: "gpt-realtime-2.1", key: "synthetic-key", language: "ko-KR", enableTools: true) { _ in }
        await fulfillment(of: [opened], timeout: 1)
        f.socket.received?(["type": "session.updated"])
    }

    private final class ToolFixture {
        let audio = Audio(), socket = Socket()
        var foreground = true
        var requests: [[String: Any]] = [], cancelled: [[String: Any]] = []
        lazy var call = RealtimeVoiceCall(audio: audio, socket: socket,
                                          ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }),
                                          permission: { $0(true) }, foreground: { [weak self] in self?.foreground == true })
        { [weak self] name, body in
            if name == "VoiceRealtimeToolCall" {
                self?.requests.append(body)
            }
            if name == "VoiceRealtimeToolCancelled" {
                self?.cancelled.append(body)
            }
        }

        func request(arguments: String = "{}") {
            socket.received?(["type": "input_audio_buffer.committed", "item_id": "input_1"])
            socket.received?(["type": "response.created", "response": ["id": "response_1"]])
            socket.received?(["type": "response.function_call_arguments.done", "response_id": "response_1", "call_id": "tool_1", "name": "orot_conversation", "arguments": arguments])
        }

        func complete(_ status: String = "completed") {
            socket.received?(["type": "response.done", "response": ["id": "response_1", "status": status]])
        }
    }
}
