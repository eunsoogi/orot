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
        socket.received?(["type": "session.updated"])
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
        socket.received?(["type": "session.updated"])
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        XCTAssertNil(call.id)
        XCTAssertEqual(audio.starts, 0)
        await opening(call, socket: socket, id: "next")
        socket.received?(["type": "session.updated"])
        try system.prepare?()
        system.activated?()
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        XCTAssertEqual(call.id, "next")
        XCTAssertEqual(audio.starts, 1)
        NotificationCenter.default.post(name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        XCTAssertNil(call.id)
        XCTAssertFalse(call.systemCallActive)
    }

    private final class SystemCall: VoiceSystemCallPort {
        var starts = 0, ends = 0
        var prepare: (() throws -> Void)?
        var activated: (() -> Void)?
        func start(owner _: UUID, prepare: @escaping () throws -> Void, activated: @escaping () -> Void,
                   ended _: @escaping () -> Void, muted _: @escaping () -> Void) throws
        {
            starts += 1; self.prepare = prepare; self.activated = activated
        }

        func end(owner _: UUID) {
            ends += 1
        }
    }
}
