import CallKit
import Foundation
@testable import Orot
import UIKit
import XCTest

/// Injected system lifecycle events exercise capture gates without starting CallKit or audio.
extension RealtimeVoiceLifecycleTests {
    func testSystemActivationGatesCaptureAndLateActivationCannotRestartStoppedCall() async throws {
        let audio = Audio(), socket = Socket(), system = SystemCall()
        var activations: [Bool] = []
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { activations.append($0) })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership, systemCall: system,
                                     permission: { $0(true) }, foreground: { true }, emit: { _, _ in })
        await opening(call, socket: socket)
        socket.received?(started())
        XCTAssertEqual(system.starts, 1)
        XCTAssertEqual(audio.starts, 0)
        XCTAssertEqual(activations, [])
        try system.prepare?()
        XCTAssertEqual(audio.starts, 0)
        system.activated?()
        XCTAssertEqual(audio.starts, 1)
        XCTAssertTrue(call.systemCallActive)
        XCTAssertEqual(activations, [])
        let staleActivation = system.activated
        try call.stop("call")
        XCTAssertFalse(call.systemCallActive)
        XCTAssertEqual(activations, [false])
        XCTAssertEqual(system.ends, 1)
        XCTAssertEqual(call.connectedDuration.take("call")?["callId"] as? String, "call")
        XCTAssertNil(call.connectedDuration.take("call"))
        // The same production lease rejects old cleanup even after the next call owns it.
        staleActivation?()
        XCTAssertEqual(audio.starts, 1)
    }

    func testBackgroundRequiresSystemActivationAndProtectedDataLossAlwaysStops() async throws {
        let audio = Audio(), socket = Socket(), system = SystemCall()
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership, systemCall: system,
                                     permission: { $0(true) }, foreground: { true }, emit: { _, _ in })
        await opening(call, socket: socket)
        socket.received?(started())
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        XCTAssertNil(call.id)
        XCTAssertEqual(audio.starts, 0)
        await opening(call, socket: socket, id: "next")
        socket.received?(started())
        try system.prepare?()
        system.activated?()
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        XCTAssertEqual(call.id, "next")
        XCTAssertEqual(audio.starts, 1)
        NotificationCenter.default.post(name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        XCTAssertNil(call.id)
        XCTAssertFalse(call.systemCallActive)
    }

    func testDeniedAsyncOpeningClearsOwnedCallBeforeBridgeRejection() async throws {
        let audio = Audio(), socket = Socket()
        let rejected = expectation(description: "opening rejected after permission denial")
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership,
                                     permission: { $0(false) }, foreground: { true }, emit: { _, _ in })
        call.open("call", model: "gpt-live-1.1", key: "synthetic", language: "auto") { result in
            if case .success = result {
                XCTFail("Denied permission admitted the call")
            }
            XCTAssertNil(call.id)
            XCTAssertNil(call.token)
            rejected.fulfill()
        }
        await fulfillment(of: [rejected], timeout: 1)
        XCTAssertEqual(socket.opens, 0)
        XCTAssertEqual(audio.starts, 0)
        let free = try ownership.reserve()
        try ownership.release(free)
    }

    func testCallKitMuteEmitsOnlyOwnedResumableReceipt() async throws {
        let audio = Audio(), socket = Socket(), system = SystemCall()
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        var receipts: [String] = []
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership, systemCall: system,
                                     permission: { $0(true) }, foreground: { true }, emit: { name, body in
                                         if name == "VoiceRealtimePaused", let id = body["callId"] as? String {
                                             receipts.append(id)
                                         }
                                     })
        await opening(call, socket: socket)
        socket.received?(started())
        try system.prepare?()
        system.activated?()
        let oldMute = system.muted
        oldMute?()
        XCTAssertEqual(receipts, ["call"])
        XCTAssertEqual(audio.stops, 1)
        XCTAssertEqual(socket.opens, 1)
        XCTAssertEqual(socket.closes, 0)
        XCTAssertNil(call.token)
        oldMute?()
        try call.stop("call")
        await opening(call, socket: socket, id: "next")
        oldMute?()
        XCTAssertEqual(receipts, ["call"])
        XCTAssertEqual(call.id, "next")
        try call.stop("next")
    }

    func testUserStopCutsLocalAudioBeforeGracefulCloseWhileReadinessGatesIt() async throws {
        let audio = Audio(), socket = Socket()
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        var requested: [String] = []
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership,
                                     permission: { $0(true) }, foreground: { true }, emit: { _, _ in })
        socket.graceful = { id in
            XCTAssertEqual(audio.stops, 2)
            XCTAssertNil(call.token)
            requested.append(id)
        }
        defer { socket.graceful = nil }
        await opening(call, socket: socket)
        try call.stop("call", graceful: true)
        XCTAssertEqual(socket.closes, 1)
        XCTAssertTrue(requested.isEmpty)
        await opening(call, socket: socket, id: "next")
        socket.received?(started())
        try call.stop("next", graceful: true)
        try call.stop("next", graceful: true)
        XCTAssertEqual(socket.opens, 2)
        XCTAssertEqual(socket.closes, 1)
        XCTAssertEqual(requested, ["fake-live"])
        XCTAssertNil(call.id)
    }

    func testCallKitEndBeforeActivationCleansUpRealUnattachedAudio() async throws {
        let audio = RealtimeVoiceAudio(), socket = Socket(), system = SystemCall()
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        var interrupted = false
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership, systemCall: system,
                                     permission: { $0(true) }, foreground: { true }, emit: { event, _ in
                                         if event == "VoiceRealtimeInterrupted" {
                                             interrupted = true
                                         }
                                     })
        await opening(call, socket: socket)
        socket.received?(started())
        XCTAssertEqual(system.starts, 1)
        let staleActivation = system.activated
        XCTAssertNotNil(staleActivation)
        let writes = socket.sent.count
        // CallKit rejection/reset can arrive before the graph attaches any player.
        system.ended?()
        XCTAssertTrue(interrupted)
        XCTAssertNil(call.id)
        XCTAssertNil(call.token)
        XCTAssertEqual(socket.closes, 1)
        XCTAssertTrue(audio.isDrained)
        XCTAssertEqual(audio.cancel(), 0)
        XCTAssertNil(call.connectedDuration.take("call"))
        staleActivation?()
        XCTAssertFalse(call.systemCallActive)
        XCTAssertEqual(socket.sent.count, writes)
        try call.stop("call")
        XCTAssertEqual(socket.closes, 1)
    }

    func testCallKitDiagnosticIncludesOnlyRecognizedTransactionCodes() {
        let known = CXErrorCodeRequestTransactionError.unentitled.rawValue
        let allowed = NSError(domain: CXErrorDomainRequestTransaction, code: known,
                              userInfo: [NSLocalizedDescriptionKey: "synthetic private description"])
        XCTAssertEqual(VoiceSystemCallLifecycle.requestTransactionDiagnosticCode(allowed), known)
        XCTAssertNil(VoiceSystemCallLifecycle.requestTransactionDiagnosticCode(
            NSError(domain: "synthetic-sensitive-domain", code: known),
        ))
        XCTAssertNil(VoiceSystemCallLifecycle.requestTransactionDiagnosticCode(
            NSError(domain: CXErrorDomainRequestTransaction, code: 10000),
        ))
    }

    func testTerminalMatchingRequiresCurrentSessionAndCorrelatedCommand() {
        var event: [String: Any] = [
            "type": "session.closed", "event_id": "server", "client_event_id": "cmd", "reason": "close_requested",
            "session": ["id": "live1", "model": "gpt-live-1.1", "status": "active"],
        ]
        XCTAssertTrue(RealtimeVoiceSocket.matchesClose(event, sessionID: "live1", command: "cmd"))
        XCTAssertFalse(RealtimeVoiceSocket.matchesClose(event, sessionID: "live2", command: "cmd"))
        XCTAssertFalse(RealtimeVoiceSocket.matchesClose(event, sessionID: "live1", command: "wrong"))
        event.removeValue(forKey: "client_event_id")
        XCTAssertTrue(RealtimeVoiceSocket.matchesClose(event, sessionID: "live1", command: "cmd"))
        event["type"] = "session.usage.updated"
        XCTAssertFalse(RealtimeVoiceSocket.matchesClose(event, sessionID: "live1", command: "cmd"))
    }

    private final class SystemCall: VoiceSystemCallPort {
        var starts = 0, ends = 0
        var prepare: (() throws -> Void)?
        var activated: (() -> Void)?
        var muted: (() -> Void)?
        var ended: (() -> Void)?
        func start(owner _: UUID, prepare: @escaping () throws -> Void, activated: @escaping () -> Void,
                   ended: @escaping () -> Void, muted: @escaping () -> Void) throws
        {
            starts += 1; self.prepare = prepare; self.activated = activated; self.muted = muted; self.ended = ended
        }

        func end(owner _: UUID) {
            ends += 1
        }
    }
}
