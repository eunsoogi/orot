import AVFoundation
import Foundation
@testable import Orot
import XCTest

/// Uses the production speech adapter and real audio session with synthetic, silent speech.
/// This proves system callbacks and release, not audible quality, microphone input or a provider response.
final class VoiceConversationLifecycleTests: OrotFailFastTestCase {
    @MainActor
    func testSystemSpeechCompletionAndStopReleasePlayback() async throws {
        let owner = AudioSessionOwnership.shared
        let token = try owner.reserve()
        var released = false
        let speech = VoiceConversationSpeech()
        defer {
            speech.stop()
            if !released {
                try? owner.release(token)
            }
        }
        try owner.activate(token, category: .playback, mode: .spokenAudio)
        let completed = expectation(description: "Actual system speech delegate completes the synthetic phrase")
        completed.assertForOverFulfill = true
        XCTAssertTrue(speech.speak("테스트입니다.", language: "ko-KR", volume: 0) { spoken in
            XCTAssertTrue(spoken)
            completed.fulfill()
        })
        await fulfillment(of: [completed], timeout: 20)
        let cancelled = expectation(description: "Explicit Stop settles system speech once")
        cancelled.assertForOverFulfill = true
        var count = 0
        XCTAssertTrue(speech.speak(String(repeating: "음성 중지 검증입니다. ", count: 40), language: "ko-KR", volume: 0) { spoken in
            count += 1
            XCTAssertFalse(spoken)
            cancelled.fulfill()
        })
        XCTAssertTrue(speech.stop())
        XCTAssertTrue(speech.stop())
        await fulfillment(of: [cancelled], timeout: 5)
        XCTAssertEqual(count, 1)
        try owner.release(token)
        released = true
        let next = try owner.reserve()
        defer { try? owner.release(next) }
        try owner.activate(next, category: .playback, mode: .spokenAudio)
        try owner.release(next)
    }
}
