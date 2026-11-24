import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    func testConnectingCueFencesCaptureAndDoesNotRepeatOnResume() async throws {
        let cue = HeldConnectingCue(), socket = Socket(), audio = Audio()
        let call = connectingFixture(audio, socket, cue)
        await opening(call, socket: socket)
        XCTAssertEqual(cue.callbacks.count, 1)
        XCTAssertTrue(socket.sent.isEmpty)
        socket.received?(started())
        XCTAssertEqual(audio.starts, 0)
        let finish = try XCTUnwrap(cue.callbacks.first)
        finish(true); finish(true)
        XCTAssertEqual(socket.sent.count, 1)
        socket.received?(started())
        XCTAssertEqual(audio.starts, 1)
        try call.pause("call")
        let resumed = expectation(description: "synthetic resume request")
        socket.sentEvent = { event in
            if event["type"] as? String == "session.input_audio.unmute" {
                resumed.fulfill()
            }
        }
        call.resume("call") { _ in }
        await fulfillment(of: [resumed], timeout: 1)
        XCTAssertEqual(cue.callbacks.count, 1)
        try call.stop("call")
    }

    func testConnectingCueWaitsForAdmissionAndLateStopCannotSendOnNextAttempt() async throws {
        let cue = HeldConnectingCue(), socket = Socket(), audio = Audio()
        var allowed = false
        let call = connectingFixture(audio, socket, cue, allowed: { allowed })
        let denied = expectation(description: "permission denied")
        call.open("call", model: "gpt-live-1.1", key: "synthetic", language: "auto") { _ in denied.fulfill() }
        await fulfillment(of: [denied], timeout: 1)
        XCTAssertTrue(cue.callbacks.isEmpty)
        XCTAssertEqual(socket.opens, 0)
        allowed = true
        await opening(call, socket: socket)
        let stale = try XCTUnwrap(cue.callbacks.first)
        try call.stop("call")
        XCTAssertGreaterThan(cue.cancellations, 0)
        await opening(call, socket: socket, id: "next")
        XCTAssertEqual(cue.callbacks.count, 2)
        stale(true)
        XCTAssertTrue(socket.sent.isEmpty)
        let current = try XCTUnwrap(cue.callbacks.last)
        current(true)
        XCTAssertEqual(socket.sent.count, 1)
        try call.stop("next")
    }

    private func connectingFixture(_ audio: Audio, _ socket: Socket, _ cue: HeldConnectingCue,
                                   allowed: @escaping () -> Bool = { true }) -> RealtimeVoiceCall
    {
        RealtimeVoiceCall(audio: audio, socket: socket,
                          ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }),
                          connectingCue: cue, permission: { $0(allowed()) }, foreground: { true }, emit: { _, _ in })
    }
}

private final class HeldConnectingCue: RealtimeConnectingCuePort {
    var callbacks: [(Bool) -> Void] = []
    var cancellations = 0

    func play(ownership _: AudioSessionOwnership, token _: AudioSessionOwnership.Token, finished: @escaping (Bool) -> Void) {
        callbacks.append(finished)
    }

    func cancel() {
        cancellations += 1
    }
}
