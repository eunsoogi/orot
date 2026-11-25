import Foundation
@testable import Orot
import XCTest

extension RealtimeVoiceLifecycleTests {
    func assertReadyCueWaitsForCaptureAndDoesNotRepeatOnResume() async throws {
        let audio = HeldReadyCueAudio(), socket = Socket()
        let system = HeldReadyCueSystemCall()
        let call = readyCueFixture(audio, socket, system: system)
        await opening(call, socket: socket)
        XCTAssertEqual(socket.sent.compactMap { $0["type"] as? String }, ["session.start"])
        XCTAssertTrue(audio.cueCompletions.isEmpty)
        socket.received?(started())
        socket.received?(started())
        XCTAssertEqual(audio.starts, 0)
        XCTAssertTrue(audio.cueCompletions.isEmpty)
        try system.prepare?()
        XCTAssertEqual(audio.starts, 0)
        system.activate?()
        system.activate?()
        XCTAssertEqual(audio.starts, 1)
        XCTAssertEqual(audio.cueCompletions.count, 1)
        XCTAssertFalse(call.ready)

        audio.input?(Data([0, 0]))
        await drainCueCallbacks()
        XCTAssertEqual(socket.sent.compactMap { $0["type"] as? String }, ["session.start"])
        let finish = try XCTUnwrap(audio.cueCompletions.first)
        finish(); finish()
        XCTAssertTrue(call.ready)
        audio.input?(Data([0, 0]))
        await drainCueCallbacks()
        XCTAssertEqual(socket.sent.last?["type"] as? String, "session.input_audio.append")

        // Exercise the real call admission and existing player-render event port without a route or provider.
        var renderDurations: [Int] = []
        call.outputRenderClock = { .now() }
        call.reportOutputRender = { renderDurations.append($0) }
        let delta = ["type": "session.output_audio.delta", "delta": Data([0, 1]).base64EncodedString()]
        let oldMeter = try XCTUnwrap(audio.displayLevel)
        oldMeter(.output, 0.5)
        XCTAssertTrue(renderDurations.isEmpty)
        socket.received?(delta)
        oldMeter(.output, 0)
        oldMeter(.input, 0.5)
        XCTAssertTrue(renderDurations.isEmpty)
        oldMeter(.output, 0.5)
        oldMeter(.output, 0.5)
        XCTAssertEqual(renderDurations.count, 1)
        socket.received?(delta)
        call.interrupt()
        oldMeter(.output, 0.5)
        XCTAssertEqual(renderDurations.count, 1)

        try call.pause("call")
        let requested = expectation(description: "unmute sent on same synthetic session")
        socket.sentEvent = { event in
            if event["type"] as? String == "session.input_audio.unmute" {
                requested.fulfill()
            }
        }
        call.resume("call") { _ in }
        await fulfillment(of: [requested], timeout: 1)
        let resumeID = try XCTUnwrap(socket.sent.last?["event_id"] as? String)
        socket.received?(["type": "session.input_audio.unmuted", "client_event_id": resumeID])
        try system.prepare?()
        system.activate?()
        XCTAssertEqual(audio.starts, 2)
        XCTAssertEqual(audio.cueCompletions.count, 1)
        XCTAssertTrue(call.ready)
        socket.received?(delta)
        oldMeter(.output, 0.5)
        XCTAssertEqual(renderDurations.count, 1)
        audio.displayLevel?(.output, 0.5)
        XCTAssertEqual(renderDurations.count, 2)
        try call.stop("call")
    }

    func assertReadyCueDeniesFailedAndRetiredAttempts() async throws {
        let audio = HeldReadyCueAudio(), socket = Socket()
        audio.startFails = true
        var allowed = false
        let call = readyCueFixture(audio, socket, allowed: { allowed })
        let denied = expectation(description: "permission denied before transport")
        call.open("call", model: "gpt-live-1.1", key: "synthetic", language: "auto") { _ in denied.fulfill() }
        await fulfillment(of: [denied], timeout: 1)
        XCTAssertEqual(socket.opens, 0)
        XCTAssertTrue(audio.cueCompletions.isEmpty)
        allowed = true

        await opening(call, socket: socket)
        socket.received?(started())
        XCTAssertTrue(audio.cueCompletions.isEmpty)
        XCTAssertFalse(call.ready)
        XCTAssertNil(call.id)

        audio.startFails = false
        await opening(call, socket: socket)
        socket.received?(started())
        let stale = try XCTUnwrap(audio.cueCompletions.first)
        try call.stop("call")
        await opening(call, socket: socket)
        socket.received?(started())
        XCTAssertEqual(audio.cueCompletions.count, 2)
        stale()
        XCTAssertFalse(call.ready)
        try XCTUnwrap(audio.cueCompletions.last)()
        XCTAssertTrue(call.ready)
        try call.stop("call")

        await opening(call, socket: socket)
        socket.received?(started())
        let stalled = try XCTUnwrap(audio.cueCompletions.last)
        try XCTUnwrap(call.timer).fire()
        stalled()
        XCTAssertFalse(call.ready)
        XCTAssertNil(call.id)
        XCTAssertEqual(socket.sent.last?["type"] as? String, "session.start")

        let fence = RealtimeVoiceCueCaptureFence()
        XCTAssertFalse(fence.permits(hostTime: 100))
        fence.open(after: 150)
        XCTAssertFalse(fence.permits(hostTime: nil))
        XCTAssertFalse(fence.permits(hostTime: 100))
        XCTAssertFalse(fence.permits(hostTime: 150))
        XCTAssertTrue(fence.permits(hostTime: 151))
    }

    private func drainCueCallbacks() async {
        let drained = expectation(description: "synthetic input callback dispatched")
        DispatchQueue.main.async { drained.fulfill() }
        await fulfillment(of: [drained], timeout: 1)
    }

    private func readyCueFixture(_ audio: HeldReadyCueAudio, _ socket: Socket,
                                 system: VoiceSystemCallPort? = nil, allowed: @escaping () -> Bool = { true }) -> RealtimeVoiceCall
    {
        RealtimeVoiceCall(audio: audio, socket: socket,
                          ownership: AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in }),
                          systemCall: system, permission: { $0(allowed()) }, foreground: { true }, emit: { _, _ in })
    }
}

private final class HeldReadyCueAudio: RealtimeVoiceReadyCueAudioPort, RealtimeVoiceDisplayMeterPort {
    var displayLevel: ((RealtimeVoiceLevelDirection, Double) -> Void)?
    enum Failure: Error { case synthetic }
    var startFails = false
    var starts = 0
    var isDrained = true
    var drained: (() -> Void)?
    var input: ((Data) -> Void)?
    var cueCompletions: [() -> Void] = []

    func start(input: @escaping (Data) -> Void, failure _: @escaping () -> Void) throws {
        guard !startFails else { throw Failure.synthetic }
        starts += 1
        self.input = input
    }

    func start(input: @escaping (Data) -> Void, failure: @escaping () -> Void,
               playReadyCue: Bool, ready: @escaping () -> Void) throws
    {
        try start(input: input, failure: failure)
        if playReadyCue {
            cueCompletions.append(ready)
        } else {
            ready()
        }
    }

    func append(_: Data) throws {}

    func cancel() -> Int {
        0
    }

    func stop() {
        input = nil
    }
}

private final class HeldReadyCueSystemCall: VoiceSystemCallPort {
    var prepare: (() throws -> Void)?
    var activate: (() -> Void)?

    func start(owner _: UUID, prepare: @escaping () throws -> Void, activated: @escaping () -> Void,
               ended _: @escaping () -> Void, muted _: @escaping () -> Void) throws
    {
        self.prepare = prepare
        activate = activated
    }

    func end(owner _: UUID) {
        prepare = nil
        activate = nil
    }
}
