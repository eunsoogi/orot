import AVFoundation
import Foundation
@testable import Orot
import UIKit
import XCTest

/// A synthetic queued permission response must not make an obsolete OS notification authoritative.
extension RealtimeVoiceLifecycleTests {
    func testStaleActiveNotificationCannotOpenOrRetirePendingLiveCall() async {
        let audio = Audio(), socket = Socket()
        var foreground = false
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership,
                                     permission: { $0(true) }, foreground: { foreground }, emit: { _, _ in })
        defer { try? call.stop("call") }
        call.open("call", model: "gpt-live-1.1", key: "synthetic-key", language: "auto") { _ in }
        let queued = expectation(description: "permission callback stored a pending start")
        DispatchQueue.main.async { queued.fulfill() }
        await fulfillment(of: [queued], timeout: 1)
        XCTAssertNotNil(call.pending)
        XCTAssertEqual(socket.opens, 0)

        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertEqual(socket.opens, 0)
        XCTAssertEqual(socket.closes, 0)
        XCTAssertTrue(socket.sent.isEmpty)
        XCTAssertEqual(call.id, "call")
        XCTAssertNotNil(call.pending)

        foreground = true
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertEqual(socket.opens, 1)
        XCTAssertEqual(socket.sent.compactMap { $0["type"] as? String }, ["session.start"])
        XCTAssertNil(call.pending)
        XCTAssertEqual(audio.starts, 0, "Socket admission is not an audio activation.")
    }

    func testBackgroundRequiresSystemActivationAndProtectedDataLossAlwaysStops() async throws {
        try await assertOwnedBackgroundContinuationDistinguishesTransportAndServerTermination()
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
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil,
                                        userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue])
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        XCTAssertTrue(call.id == "next" && audio.starts == 1)
        NotificationCenter.default.post(name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        XCTAssertNil(call.id)
        XCTAssertFalse(call.systemCallActive)
    }

    private func assertOwnedBackgroundContinuationDistinguishesTransportAndServerTermination() async throws {
        let audio = Audio(), socket = Socket(), system = SystemCall()
        let ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { _ in })
        var foreground = true
        var diagnostics: [VoiceSystemCallLifecycle.DiagnosticStage] = []
        let call = RealtimeVoiceCall(audio: audio, socket: socket, ownership: ownership, systemCall: system,
                                     permission: { $0(true) }, foreground: { foreground }, emit: { _, _ in })
        call.reportTermination = { diagnostics.append($0) }
        await opening(call, socket: socket)
        socket.received?(started())
        try system.prepare?()
        system.activated?()
        foreground = false
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        XCTAssertEqual(call.id, "call")
        XCTAssertEqual(socket.closes, 0)
        socket.received?(["type": "session.output_audio.delta", "delta": "AAA="])
        XCTAssertEqual(audio.appends, 1)
        let oldFailure = socket.failed
        socket.received?(["type": "session.closed", "reason": "synthetic private payload"])
        XCTAssertEqual(diagnostics, [.liveServerClosed])
        XCTAssertNil(call.id)
        foreground = true
        await opening(call, socket: socket, id: "next")
        socket.received?(started())
        try system.prepare?()
        system.activated?()
        oldFailure?()
        XCTAssertEqual(diagnostics, [.liveServerClosed])
        XCTAssertEqual(call.id, "next")
        socket.failed?()
        XCTAssertEqual(diagnostics, [.liveServerClosed, .liveTransportFailed])
        XCTAssertNil(call.id)
    }

    func testLifecycleDiagnosticsClassifyOnlyRecognizedStates() {
        let status = { VoiceSystemCallLifecycle.backgroundStage(systemCallActive: $0, managed: $1) }
        XCTAssertEqual(status(false, false), .backgroundUnownedStopped)
        XCTAssertEqual(status(false, true), .backgroundUnownedStopped)
        XCTAssertEqual(status(true, false), .backgroundContinued)
        XCTAssertEqual(status(true, true), .backgroundManagedStopped)
        XCTAssertEqual(VoiceSystemCallLifecycle.backgroundStage(systemCallActive: true, managed: false, audioStarting: true),
                       .backgroundAudioStartingStopped)
        let interruption = VoiceSystemCallLifecycle.interruptionStage
        for (raw, expected) in [(AVAudioSession.InterruptionType.began.rawValue, VoiceSystemCallLifecycle.DiagnosticStage.interruptionBegan),
                                (AVAudioSession.InterruptionType.ended.rawValue, .interruptionEnded),
                                (UInt.max, .interruptionUnspecified)]
        {
            let note = Notification(name: AVAudioSession.interruptionNotification, userInfo: [AVAudioSessionInterruptionTypeKey: raw, "synthetic": "never logged"])
            XCTAssertEqual(interruption(note), expected)
        }
    }
}
