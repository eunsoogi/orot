import AVFoundation
import Foundation
@testable import Orot
import Security
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

extension RealtimeVoiceLifecycleTests {
    @MainActor
    func testV3LiveToolSettingsRequiresExactProtectedPairedWitness() throws {
        let response = String(repeating: "a", count: 64)
        let voice = String(repeating: "b", count: 64)
        let epoch = String(repeating: "c", count: 64)
        let next = String(repeating: "d", count: 64)
        let grant = response + "-model"
        let base = try XCTUnwrap(LiveResponsesSettingsGrant(["backendModel": "gpt-6-luna", "generation": response, "grantID": grant]))
        let pair: [String: Any] = ["version": 1, "credentialEpoch": epoch, "backendModel": base.backendModel,
                                   "speechModel": "gpt-live-1.1", "voiceGeneration": voice, "responsesGeneration": response]
        let marker = ["scope": "selected-live-conversation-local-tools-v3", "providerId": "openai-live-responses",
                      "recipient": "OpenAI Responses (Live)", "backendModel": base.backendModel, "credentialEpoch": epoch,
                      "generation": response, "grantID": grant, "voiceGeneration": voice]
        let raw = try JSONSerialization.data(withJSONObject: marker)
        XCTAssertEqual(LiveConversationToolsSettingsWitness.decodePolicy(raw, accessibility: kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String), marker)
        XCTAssertNil(LiveConversationToolsSettingsWitness.decodePolicy(raw, accessibility: kSecAttrAccessibleWhenUnlocked as String))
        XCTAssertNil(LiveConversationToolsSettingsWitness.decodePolicy(raw, accessibility: nil))

        let modes = ["exact", "locked", "lock-after-marker", "rotated-second-marker", "wrong-key", "wrong-scope",
                     "wrong-recipient", "wrong-grant", "extra-marker", "legacy", "missing", "v2-only", "wrong-pair",
                     "duplicate-pair", "revoked-audio", "replaced-responses", "bool-version"]
        for mode in modes {
            var protected = mode != "locked"
            var currentEpoch = epoch
            var reads: [String] = []
            var markerReads = 0
            let result = LiveConversationToolsSettingsWitness.resolve(base: base, key: "synthetic-account", protected: { protected },
                                                                      read: { service, account -> [String: Any]? in
                                                                          reads.append(service)
                                                                          if service == "com.orot.mobile.voice-settings.v1", account == "voice-settings" {
                                                                              let candidates: [[String: Any]] = [["pair": pair], ["pair": pair]]
                                                                              var credential: [String: Any] = [
                                                                                  "apiKey": mode == "wrong-key" ? "other" : "synthetic-account",
                                                                                  "credentialEpoch": currentEpoch,
                                                                                  "pairCandidates": mode == "wrong-pair" ? [] : Array(candidates.prefix(mode == "duplicate-pair" ? 2 : 1)),
                                                                              ]
                                                                              if mode != "legacy" {
                                                                                  credential["effectiveResponsesGeneration"] = response
                                                                              }
                                                                              return credential
                                                                          }
                                                                          guard account == "settings-consent-authority" else { return nil }
                                                                          switch service {
                                                                          case "com.orot.mobile.settings-consent-authority.v1.voice":
                                                                              return ["version": mode == "bool-version" ? NSNumber(value: true) : NSNumber(value: 1),
                                                                                      "status": mode == "revoked-audio" ? "revoked" : "active", "generation": voice]
                                                                          case "com.orot.mobile.settings-consent-authority.v1.voice-responses":
                                                                              return ["version": 1, "status": "active", "generation": mode == "replaced-responses" ? next : response]
                                                                          default:
                                                                              return nil
                                                                          }
                                                                      },
                                                                      policy: { service, account in
                                                                          XCTAssertEqual(service, "com.orot.mobile.live-conversation-tools-policy.v3." + response)
                                                                          XCTAssertEqual(account, "live-conversation-tools-policy")
                                                                          markerReads += 1
                                                                          if mode == "lock-after-marker" {
                                                                              protected = false
                                                                          }
                                                                          if mode == "rotated-second-marker", markerReads == 2 {
                                                                              currentEpoch = next
                                                                          }
                                                                          if mode == "missing" || mode == "v2-only" {
                                                                              return nil
                                                                          }
                                                                          var row = marker
                                                                          if mode == "wrong-scope" {
                                                                              row["scope"] = "selected-live-heart-rate-aggregate-v2"
                                                                          }
                                                                          if mode == "wrong-recipient" {
                                                                              row["recipient"] = "other"
                                                                          }
                                                                          if mode == "wrong-grant" {
                                                                              row["grantID"] = next + "-model"
                                                                          }
                                                                          if mode == "extra-marker" {
                                                                              row["extra"] = "synthetic"
                                                                          }
                                                                          return row
                                                                      })
            XCTAssertEqual(result?.voiceGeneration, mode == "exact" ? voice : nil, mode)
            XCTAssertFalse(reads.contains { $0.contains("live-responses-settings") || $0.contains("live-health-context") })
            if mode == "locked" {
                XCTAssertEqual(markerReads, 0); XCTAssertTrue(reads.isEmpty)
            }
        }
    }
}
