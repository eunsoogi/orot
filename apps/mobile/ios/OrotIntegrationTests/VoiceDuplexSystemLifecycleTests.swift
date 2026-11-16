import AVFoundation
import Foundation
@testable import Orot
import Speech
import UIKit
import XCTest

/// Runs the shipping local coordinator with synthetic ports, never CallKit, permissions or microphone capture.
@MainActor
final class VoiceDuplexSystemLifecycleTests: OrotFailFastTestCase {
    func testSystemActivationGatesLocalCaptureAndLateActivationCannotRestart() async throws {
        let f = Fixture()
        let call = f.call()
        await opening(call, system: f.system)
        XCTAssertEqual(f.audio.starts, 0)
        XCTAssertEqual(f.recognition.starts, 0)
        try f.system.prepare?()
        XCTAssertEqual(f.audio.starts, 0)
        f.system.activated?()
        XCTAssertEqual(f.audio.starts, 1)
        XCTAssertEqual(f.recognition.starts, 1)
        XCTAssertTrue(call.systemCallActive)
        XCTAssertEqual(f.activations, [])
        let old = f.system.activated
        try call.stop("call")
        XCTAssertFalse(call.isActive)
        XCTAssertEqual(f.activations, [false])
        await opening(call, system: f.system, id: "next")
        old?()
        XCTAssertEqual(f.audio.starts, 1)
        try f.system.prepare?()
        f.system.activated?()
        XCTAssertEqual(f.audio.starts, 2)
        try call.stop("next")
    }

    func testSystemMuteAndEndReleaseOnlyTheOwnedCall() async throws {
        for muted in [false, true] {
            let f = Fixture()
            let call = f.call()
            await opening(call, system: f.system)
            f.system.activated?()
            let late = f.system.activated
            if muted {
                f.system.muted?()
            } else {
                f.system.ended?()
            }
            XCTAssertFalse(call.isActive)
            XCTAssertFalse(call.systemCallActive)
            XCTAssertEqual(f.audio.stops, 1)
            XCTAssertEqual(f.recognition.stops, 1)
            XCTAssertEqual(f.system.ends, 1)
            XCTAssertEqual(f.activations, [false])
            late?()
            XCTAssertEqual(f.audio.starts, 1)
            let replacement = try f.ownership.reserve()
            try call.stop("call")
            XCTAssertThrowsError(try f.ownership.reserve())
            try f.ownership.release(replacement)
        }
    }

    func testBackgroundPendingStopsButActivatedCallSurvivesUntilProtectionLoss() async {
        let f = Fixture()
        let call = f.call()
        await opening(call, system: f.system)
        let pending = f.system.activated
        call.applicationLifecycleChanged(UIApplication.didEnterBackgroundNotification)
        pending?()
        XCTAssertFalse(call.isActive)
        XCTAssertEqual(f.audio.starts, 0)
        await opening(call, system: f.system, id: "next")
        f.system.activated?()
        call.applicationLifecycleChanged(UIApplication.didEnterBackgroundNotification)
        XCTAssertTrue(call.isActive)
        call.applicationLifecycleChanged(UIApplication.protectedDataWillBecomeUnavailableNotification)
        XCTAssertFalse(call.isActive)
        XCTAssertFalse(call.systemCallActive)
        XCTAssertEqual(f.audio.starts, 1)
        XCTAssertEqual(f.activations, [false])
    }

    func testStopBeforePermissionCompletionAndDisposeDoNotRestartCapture() async throws {
        let f = Fixture()
        var permission: ((SFSpeechRecognizerAuthorizationStatus) -> Void)?
        var call: VoiceDuplexCallCoordinator? = f.call(speech: { permission = $0 })
        call?.open("call", language: "ko-KR") { _ in }
        try call?.stop("call")
        permission?(.authorized)
        await Task.yield()
        XCTAssertEqual(f.system.starts, 0)
        XCTAssertEqual(f.audio.starts, 0)
        call = nil
        await Task.yield()
        let next = try f.ownership.reserve()
        try f.ownership.release(next)
    }

    func testDisposalStopsActiveSyntheticGraphAndReleasesOwnership() async throws {
        let f = Fixture()
        var call: VoiceDuplexCallCoordinator? = f.call()
        try await opening(XCTUnwrap(call), system: f.system)
        f.system.activated?()
        let late = f.system.activated
        call = nil
        let released = expectation(description: "native graph disposal")
        DispatchQueue.main.async { released.fulfill() }
        await fulfillment(of: [released], timeout: 1)
        XCTAssertEqual(f.audio.stops, 1)
        XCTAssertEqual(f.recognition.stops, 1)
        XCTAssertEqual(f.system.ends, 1)
        XCTAssertEqual(f.activations, [false])
        late?()
        XCTAssertEqual(f.audio.starts, 1)
        let next = try f.ownership.reserve()
        try f.ownership.release(next)
    }

    private func opening(_ call: VoiceDuplexCallCoordinator, system: SystemCall, id: String = "call") async {
        let ready = expectation(description: "synthetic system call requested")
        system.started = { ready.fulfill() }
        call.open(id, language: "ko-KR") { _ in }
        await fulfillment(of: [ready], timeout: 1)
    }

    private final class Fixture {
        let audio = Audio(), recognition = Recognition(), system = SystemCall()
        var activations: [Bool] = []
        lazy var ownership = AudioSessionOwnership(configure: { _, _, _ in }, setActive: { [weak self] in self?.activations.append($0) })
        func call(speech: @escaping (@escaping (SFSpeechRecognizerAuthorizationStatus) -> Void) -> Void = { $0(.authorized) }) -> VoiceDuplexCallCoordinator {
            VoiceDuplexCallCoordinator(systemCall: system, audio: audio, recognition: recognition, ownership: ownership,
                                       speechPermission: speech, microphonePermission: { $0(true) }, foreground: { true }, emit: { _, _ in })
        }
    }

    private final class Audio: VoiceDuplexAudioPort {
        var starts = 0, stops = 0
        func start(input _: @escaping (AVAudioPCMBuffer) -> Void) throws {
            starts += 1
        }

        func speak(_: String, language _: String, completion: @escaping (Bool) -> Void) throws {
            completion(true)
        }

        func cancelPlayback() {}
        func stop() {
            stops += 1
        }
    }

    private final class Recognition: VoiceDuplexRecognitionPort {
        var starts = 0, stops = 0
        func start(locale _: Locale, onSpeechStarted _: @escaping (Int) -> Void,
                   onTranscript _: @escaping (Int, String) -> Void, onFailure _: @escaping (Error) -> Void) throws
        {
            starts += 1
        }

        func append(_: AVAudioPCMBuffer) {}
        func finishTurn() {}
        func stop() {
            stops += 1
        }
    }

    private final class SystemCall: VoiceSystemCallPort {
        var starts = 0, ends = 0
        var started: (() -> Void)?
        var prepare: (() throws -> Void)?, activated: (() -> Void)?, ended: (() -> Void)?, muted: (() -> Void)?
        func start(owner _: UUID, prepare: @escaping () throws -> Void, activated: @escaping () -> Void,
                   ended: @escaping () -> Void, muted: @escaping () -> Void) throws
        {
            starts += 1; self.prepare = prepare; self.activated = activated; self.ended = ended; self.muted = muted
            started?()
        }

        func end(owner _: UUID) {
            ends += 1
        }
    }
}
