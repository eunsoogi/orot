import Foundation
@testable import Orot
import XCTest

/// All audio, permission, ownership and transport ports are injected. No microphone or network is used.
@MainActor
final class RealtimeVoiceLifecycleTests: OrotFailFastTestCase {
    func opening(_ call: RealtimeVoiceCall, socket: Socket, key: String = "synthetic-key", id: String = "call") async {
        let opened = expectation(description: "socket requested after synthetic permission")
        socket.opened = { opened.fulfill() }
        call.open(id, model: "gpt-live-1.1", key: key, language: "auto") { _ in }
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
        XCTAssertEqual(socket.sent.first?["type"] as? String, "session.start")
        socket.received?(started())
        XCTAssertEqual(audio.starts, 1)
        XCTAssertEqual(activated, 1)
        try call.stop("call")
        XCTAssertEqual(socket.closes, 1)
        XCTAssertEqual(audio.stops, 1)
        XCTAssertEqual(released, 1)
        socket.received?(started())
        XCTAssertEqual(audio.starts, 1)
    }

    func started(expires: TimeInterval = Date().timeIntervalSince1970 + 120) -> [String: Any] {
        ["type": "session.started", "session": ["id": "fake-live", "model": "gpt-live-1.1",
                                              "status": "active", "expires_at": expires]]
    }

    func testLiveOutputRequiresCurrentUnexpiredStartupAndPreservesPrimaryFrameOrder() async throws {
        let audio = Audio(), socket = Socket()
        let call = fixture(audio, socket)
        await opening(call, socket: socket)
        let first = socket.received
        let output = ["type": "session.output_audio.delta", "delta": "AAA="]
        first?(output)
        first?(started(expires: 1))
        first?(["type": "session.updated"])
        XCTAssertEqual(audio.starts, 0)
        XCTAssertEqual(audio.appends, 0)
        first?(started())
        first?(output)
        first?(output)
        XCTAssertEqual(audio.starts, 1)
        XCTAssertEqual(audio.appends, 2)
        XCTAssertEqual(socket.sent.first?["type"] as? String, "session.start")
        try call.stop("call")
        await opening(call, socket: socket, id: "next")
        first?(started())
        first?(output)
        XCTAssertEqual(audio.starts, 1)
        XCTAssertEqual(audio.appends, 2)
        try call.stop("next")
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
        socket.received?(started())
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
        socket.received?(started())
        let oldFailure = audio.failure
        try call.stop("call")
        await opening(call, socket: socket, id: "new-call")
        socket.received?(started())
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
        socket.received?(started())
        // Test the production queue filter without creating a socket or serializing real audio.
        let writes = [RealtimeSocketWrite(text: "in-flight", isInput: true),
                      RealtimeSocketWrite(text: "session.start", isInput: false),
                      RealtimeSocketWrite(text: "unsent-audio", isInput: true),
                      RealtimeSocketWrite(text: "session.input_audio.mute", isInput: false),
                      RealtimeSocketWrite(text: "session.input_audio.unmute", isInput: false)]
        XCTAssertEqual(RealtimeVoiceSocket.retainingControl(writes, sending: true).map(\.text),
                       ["in-flight", "session.start", "session.input_audio.mute", "session.input_audio.unmute"])
        XCTAssertEqual(RealtimeVoiceSocket.retainingControl(writes, sending: false).map(\.text),
                       ["session.start", "session.input_audio.mute", "session.input_audio.unmute"])
        let oldInput = audio.input, oldFailure = audio.failure
        try call.pause("call")
        XCTAssertEqual(socket.inputDiscards, 1)
        XCTAssertEqual(audio.stops, 1)
        XCTAssertEqual(socket.closes, 0)
        let before = socket.sent.count
        oldInput?(Data([0, 0]))
        socket.received?(["type": "session.output_audio.delta", "delta": "AAA="])
        let paused = expectation(description: "queued input drained while muted")
        DispatchQueue.main.async { paused.fulfill() }
        await fulfillment(of: [paused], timeout: 1)
        XCTAssertEqual(socket.sent.count, before)
        XCTAssertEqual(audio.appends, 0)
        let resumed = expectation(description: "same call resumed")
        let requested = expectation(description: "explicit unmute sent")
        socket.sentEvent = { event in
            if event["type"] as? String == "session.input_audio.unmute" { requested.fulfill() }
        }
        call.resume("call") { result in
            if case .failure = result {
                XCTFail("Resume failed")
            }
            resumed.fulfill()
        }
        await fulfillment(of: [requested], timeout: 1)
        XCTAssertEqual(audio.starts, 1)
        socket.received?(["type": "session.input_audio.unmuted", "client_event_id": "stale"])
        XCTAssertEqual(audio.starts, 1)
        let command = try XCTUnwrap(socket.sent.last?["event_id"] as? String)
        socket.received?(["type": "session.input_audio.unmuted", "client_event_id": command])
        await fulfillment(of: [resumed], timeout: 1)
        XCTAssertEqual(socket.opens, 1)
        XCTAssertEqual(audio.starts, 2)
        oldFailure?()
        let stale = expectation(description: "old same-ID tap failure drained")
        DispatchQueue.main.async { stale.fulfill() }
        await fulfillment(of: [stale], timeout: 1)
        XCTAssertEqual(socket.closes, 0)
        socket.received?(["type": "session.output_audio.delta", "delta": "AAA="])
        XCTAssertEqual(audio.appends, 1)
        try call.stop("call")
        XCTAssertEqual(socket.closes, 1)
    }

    private func fixture(_ audio: Audio, _ socket: Socket, emit: @escaping (String, [String: Any]) -> Void = { _, _ in }) -> RealtimeVoiceCall {
        RealtimeVoiceCall(audio: audio, socket: socket, ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }), permission: { $0(true) }, foreground: { true }, emit: emit)
    }

    private enum Failure: Error { case synthetic }
    final class Audio: RealtimeAudioPort {
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

    final class Socket: RealtimeSocketPort {
        var received: (([String: Any]) -> Void)?
        var failed: (() -> Void)?
        var opened: (() -> Void)?
        var sentEvent: (([String: Any]) -> Void)?
        var sent: [[String: Any]] = []
        var closes = 0, opens = 0, inputDiscards = 0
        var graceful: ((String) -> Void)?
        func open(model _: String, key _: String) {
            opens += 1
            opened?()
        }

        func send(_ event: [String: Any]) {
            sent.append(event)
            sentEvent?(event)
        }

        func finishLive(sessionID: String) { graceful?(sessionID) }

        func discardInput() {
            inputDiscards += 1
        }

        func close() {
            closes += 1
        }
    }
}
