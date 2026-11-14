import Foundation
@testable import Orot
import XCTest

/// All audio, permission, ownership and transport ports are injected. No microphone or network is used.
@MainActor
final class RealtimeVoiceLifecycleTests: OrotFailFastTestCase {
    private func opening(_ call: RealtimeVoiceCall, socket: Socket, key: String = "synthetic-key", id: String = "call") async {
        let opened = expectation(description: "socket requested after synthetic permission")
        socket.opened = { opened.fulfill() }
        call.open(id, model: "gpt-realtime-2.1", key: key, language: "ko-KR") { _ in }
        await fulfillment(of: [opened], timeout: 1)
    }

    func testSessionConfigurationGatesAudioAndStopClosesEverything() async throws {
        let audio = Audio(), socket = Socket()
        var activated = 0, released = 0
        let ownership = AudioSessionOwnership(configure: { _, _, _ in activated += 1 }, setActive: {
            if !$0 {
                released += 1
            }
        })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership, permission: { $0(true) }, foreground: { true }, emit: { _, _ in })
        await opening(call, socket: socket)
        XCTAssertEqual(audio.starts, 0)
        XCTAssertEqual(activated, 0)
        XCTAssertEqual(socket.sent.first?["type"] as? String, "session.update")
        socket.received?(["type": "session.updated"])
        XCTAssertEqual(audio.starts, 1)
        XCTAssertEqual(activated, 1)
        try call.stop("call")
        XCTAssertEqual(socket.closes, 1)
        XCTAssertEqual(audio.stops, 1)
        XCTAssertEqual(released, 1)
        socket.received?(["type": "session.updated"])
        XCTAssertEqual(audio.starts, 1)
    }

    func testBargeInTruncatesHeardAudioAndDropsLateOutput() async throws {
        let audio = Audio(), socket = Socket()
        let call = fixture(audio, socket)
        await opening(call, socket: socket)
        socket.received?(["type": "session.updated"])
        socket.received?(["type": "response.created", "response": ["id": "response-1"]])
        let delta: [String: Any] = ["type": "response.output_audio.delta", "response_id": "response-1", "item_id": "item-1", "content_index": 0, "delta": Data([0, 0]).base64EncodedString()]
        socket.received?(delta)
        XCTAssertEqual(audio.appends, 1)
        audio.played = 123
        socket.received?(["type": "input_audio_buffer.speech_started"])
        let truncate = socket.sent.last { $0["type"] as? String == "conversation.item.truncate" }
        XCTAssertEqual(truncate?["audio_end_ms"] as? Int, 123)
        XCTAssertEqual(truncate?["item_id"] as? String, "item-1")
        socket.received?(delta)
        XCTAssertEqual(audio.appends, 1)
        socket.received?(["type": "response.created", "response": ["id": "late"]])
        XCTAssertEqual(socket.sent.last?["type"] as? String, "response.cancel")
        try call.stop("call")
    }

    func testAlreadyDrainedResponseReturnsToListening() async throws {
        let audio = Audio(), socket = Socket()
        var phases: [String] = []
        let call = fixture(audio, socket) { name, body in
            if name == "VoiceRealtimeState", let phase = body["phase"] as? String {
                phases.append(phase)
            }
        }
        await opening(call, socket: socket)
        socket.received?(["type": "session.updated"])
        socket.received?(["type": "response.created", "response": ["id": "response-1"]])
        socket.received?(["type": "response.done", "response": ["id": "response-1", "status": "completed"]])
        XCTAssertEqual(phases.last, "listening")
        try call.stop("call")
    }

    func testReleaseFailureRetainsOwnershipForRetry() async throws {
        let audio = Audio(), socket = Socket()
        var shouldFail = true
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: {
            if !$0, shouldFail {
                throw Failure.synthetic
            }
        })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership, permission: { $0(true) }, foreground: { true }, emit: { _, _ in })
        await opening(call, socket: socket)
        socket.received?(["type": "session.updated"])
        XCTAssertThrowsError(try call.stop("call"))
        XCTAssertThrowsError(try ownership.reserve())
        shouldFail = false
        try call.stop("call")
        let token = try ownership.reserve()
        try ownership.release(token)
    }

    func testOldCaptureFailureCannotStopNewCall() async throws {
        let audio = Audio(), socket = Socket()
        let call = fixture(audio, socket)
        await opening(call, socket: socket)
        socket.received?(["type": "session.updated"])
        let oldFailure = audio.failure
        try call.stop("call")
        await opening(call, socket: socket, id: "new-call")
        socket.received?(["type": "session.updated"])
        oldFailure?()
        let delivered = expectation(description: "old callback drained")
        DispatchQueue.main.async { delivered.fulfill() }
        await fulfillment(of: [delivered], timeout: 1)
        XCTAssertEqual(audio.starts, 2)
        XCTAssertEqual(audio.stops, 1)
        XCTAssertEqual(socket.closes, 1)
        try call.stop("new-call")
    }

    func testMuteReleasesAudioAndResumesSameServerConversation() async throws {
        let audio = Audio(), socket = Socket()
        let call = fixture(audio, socket)
        await opening(call, socket: socket)
        socket.received?(["type": "session.updated"])
        // Test the production queue filter without creating a socket or serializing real audio.
        let writes = [RealtimeSocketWrite(text: "in-flight", isInput: true),
                      RealtimeSocketWrite(text: "session.update", isInput: false),
                      RealtimeSocketWrite(text: "unsent-audio", isInput: true),
                      RealtimeSocketWrite(text: "response.cancel", isInput: false),
                      RealtimeSocketWrite(text: "conversation.item.truncate", isInput: false)]
        XCTAssertEqual(RealtimeVoiceSocket.retainingControl(writes, sending: true).map(\.text),
                       ["in-flight", "session.update", "response.cancel", "conversation.item.truncate"])
        XCTAssertEqual(RealtimeVoiceSocket.retainingControl(writes, sending: false).map(\.text),
                       ["session.update", "response.cancel", "conversation.item.truncate"])
        let oldInput = audio.input, oldFailure = audio.failure
        try call.pause("call")
        XCTAssertEqual(socket.inputDiscards, 1)
        XCTAssertEqual(audio.stops, 1)
        XCTAssertEqual(socket.closes, 0)
        let before = socket.sent.count
        oldInput?(Data([0, 0]))
        socket.received?(["type": "response.output_audio.delta", "response_id": "late", "item_id": "item", "delta": "AAA="])
        let paused = expectation(description: "queued input drained while muted")
        DispatchQueue.main.async { paused.fulfill() }
        await fulfillment(of: [paused], timeout: 1)
        XCTAssertEqual(socket.sent.count, before)
        XCTAssertEqual(audio.appends, 0)
        let resumed = expectation(description: "same call resumed")
        call.resume("call") { result in
            if case .failure = result {
                XCTFail("Resume failed")
            }
            resumed.fulfill()
        }
        await fulfillment(of: [resumed], timeout: 1)
        XCTAssertEqual(socket.opens, 1)
        XCTAssertEqual(audio.starts, 2)
        oldFailure?()
        let stale = expectation(description: "old same-ID tap failure drained")
        DispatchQueue.main.async { stale.fulfill() }
        await fulfillment(of: [stale], timeout: 1)
        XCTAssertEqual(socket.closes, 0)
        socket.received?(["type": "input_audio_buffer.cleared"])
        socket.received?(["type": "input_audio_buffer.committed"])
        socket.received?(["type": "response.created", "response": ["id": "next"]])
        socket.received?(["type": "response.output_audio.delta", "response_id": "next", "item_id": "item", "delta": "AAA="])
        XCTAssertEqual(audio.appends, 1)
        try call.stop("call")
        XCTAssertEqual(socket.closes, 1)
    }

    private func fixture(_ audio: Audio, _ socket: Socket, emit: @escaping (String, [String: Any]) -> Void = { _, _ in }) -> RealtimeVoiceCall {
        RealtimeVoiceCall(audio: audio, socket: socket, ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }), permission: { $0(true) }, foreground: { true }, emit: emit)
    }

    private enum Failure: Error { case synthetic }
    private final class Audio: RealtimeAudioPort {
        var isDrained = true
        var drained: (() -> Void)?
        var failure: (() -> Void)?
        var input: ((Data) -> Void)?
        var starts = 0, stops = 0, appends = 0, played = 0
        func start(input: @escaping (Data) -> Void, failure: @escaping () -> Void) throws {
            starts += 1; self.failure = failure; self.input = input
        }

        func append(_: Data) throws {
            appends += 1
        }

        func cancel() -> Int {
            played
        }

        func stop() {
            stops += 1
        }
    }

    private final class Socket: RealtimeSocketPort {
        var received: (([String: Any]) -> Void)?
        var failed: (() -> Void)?
        var opened: (() -> Void)?
        var sent: [[String: Any]] = []
        var closes = 0, opens = 0, inputDiscards = 0
        func open(model _: String, key _: String) {
            opens += 1
            opened?()
        }

        func send(_ event: [String: Any]) {
            sent.append(event)
        }

        func discardInput() {
            inputDiscards += 1
        }

        func close() {
            closes += 1
        }
    }
}
