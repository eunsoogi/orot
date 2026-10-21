import AVFoundation
@testable import Orot
import UIKit
import XCTest

/// Requires settled permission/activation before capture and preserves interruptions that actually begin during capture.
final class RecordingMeteringBoundaryTests: OrotFailFastTestCase {
    @MainActor
    func testNotificationOccurrencePrecedesQueueDeliveryWithoutChangingActiveCaptureProtection() async throws {
        try verifyPrivateCaptureDiagnostics()
        XCTAssertFalse(RecordingMeteringProbeModule.interruptionApplies(observedAt: 9, captureBeganAt: nil))
        XCTAssertFalse(RecordingMeteringProbeModule.interruptionApplies(observedAt: 9, captureBeganAt: 10))
        XCTAssertTrue(RecordingMeteringProbeModule.interruptionApplies(observedAt: 10, captureBeganAt: 10))
        XCTAssertTrue(RecordingMeteringProbeModule.interruptionApplies(observedAt: 11, captureBeganAt: 10))

        for scenario in scenarios {
            let notifications = NotificationCenter()
            var reply: ((Bool) -> Void)?
            var results: [Bool] = []
            let permission = RecordingMeteringPermission(requiresActivation: scenario.requiresActivation, notifications: notifications) { reply = $0 }
            permission.request { results.append($0) }
            let respond = try XCTUnwrap(reply)
            for step in scenario.steps {
                switch step {
                case let .reply(allowed):
                    respond(allowed)
                    // Drain the real callback hop; an unprocessed reply must not make a premature-start assertion pass.
                    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                        DispatchQueue.main.async { continuation.resume() }
                    }
                case let .active(active):
                    notifications.post(name: active ? UIApplication.didBecomeActiveNotification : UIApplication.willResignActiveNotification, object: nil)
                case .cancel:
                    permission.cancel()
                case let .expect(expected):
                    XCTAssertEqual(results, expected, scenario.name)
                }
            }
        }
    }

    /// Generated PCM proves the decoded file clock; private native details must never enter diagnostic lines.
    private func verifyPrivateCaptureDiagnostics() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("caf")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 32000))
        buffer.frameLength = 32000
        for index in 0 ..< 32000 {
            buffer.floatChannelData![0][index] = 0
        }
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
        }
        XCTAssertEqual(try RecordingCaptureDiagnostics.encodedDurationMs(at: url), 2000)
        XCTAssertEqual(RecordingCaptureDiagnostics.line(.stopped, clockMs: 5000, encodedMs: 21),
                       "OROT_RECORDING_DIAGNOSTIC event=stopped clock_ms=5000 encoded_ms=21")
        XCTAssertEqual(RecordingCaptureDiagnostics.line(.stopped, clockMs: -1, encodedMs: -1),
                       "OROT_RECORDING_DIAGNOSTIC event=stopped")
        XCTAssertEqual(RecordingCaptureDiagnostics.failureLine("INVALID_AUDIO"),
                       "OROT_RECORDING_DIAGNOSTIC event=speech_failed reason=INVALID_AUDIO")
        for privateCode in [url.path, "INVALID_AUDIO: private speech", "private-native-error"] {
            XCTAssertEqual(RecordingCaptureDiagnostics.failureLine(privateCode),
                           "OROT_RECORDING_DIAGNOSTIC event=speech_failed reason=OTHER")
        }
    }

    private enum Step {
        case reply(Bool), active(Bool), cancel, expect([Bool])
    }

    private struct Scenario {
        let name: String
        var requiresActivation = true
        let steps: [Step]
    }

    /// The hosted failure and local trace both place the first reply before UIKit finishes the permission transition.
    private var scenarios: [Scenario] {
        [
            Scenario(name: "first reply precedes inactive and active notifications", steps: [
                .reply(true), .expect([]), .active(false), .expect([]), .active(true), .expect([true]), .active(true), .expect([true]),
            ]),
            Scenario(name: "activation precedes the permission reply", steps: [
                .active(true), .expect([]), .reply(true), .expect([true]),
            ]),
            Scenario(name: "leaving again invalidates earlier activation", steps: [
                .active(true), .active(false), .reply(true), .expect([]), .active(true), .expect([true]),
            ]),
            Scenario(name: "already decided permission while active needs no new transition", requiresActivation: false, steps: [
                .reply(true), .expect([true]),
            ]),
            Scenario(name: "denial resolves without activating or recording", steps: [
                .reply(false), .expect([false]), .active(true), .expect([false]),
            ]),
            Scenario(name: "cancellation before the reply cannot start a later capture", steps: [
                .cancel, .expect([false]), .reply(true), .active(true), .expect([false]),
            ]),
            Scenario(name: "cancellation after the reply removes the activation wait", steps: [
                .reply(true), .expect([]), .cancel, .expect([false]), .active(true), .expect([false]),
            ]),
        ]
    }
}
