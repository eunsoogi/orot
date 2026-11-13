import AVFoundation
import Foundation
@testable import Orot
import XCTest

/// Uses the production speech adapter and real audio session with synthetic, silent speech.
/// This proves system callbacks and release, not audible quality, microphone input or a provider response.
final class VoiceConversationLifecycleTests: OrotFailFastTestCase {
    func testDuplexOutputQueueHasFiniteBudget() {
        let limit = VoiceDuplexAudioEngine.maximumQueuedFrames
        XCTAssertTrue(VoiceDuplexAudioEngine.acceptsQueuedFrames(0, adding: limit))
        XCTAssertTrue(VoiceDuplexAudioEngine.acceptsQueuedFrames(limit - 1, adding: 1))
        XCTAssertFalse(VoiceDuplexAudioEngine.acceptsQueuedFrames(limit, adding: 1))
        XCTAssertFalse(VoiceDuplexAudioEngine.acceptsQueuedFrames(0, adding: limit + 1))
        XCTAssertFalse(VoiceDuplexAudioEngine.acceptsQueuedFrames(-1, adding: 1))
        XCTAssertFalse(VoiceDuplexAudioEngine.acceptsQueuedFrames(0, adding: 0))
        XCTAssertFalse(VoiceDuplexAudioEngine.acceptsQueuedFrames(Int.max, adding: Int.max))
    }

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
        // Cancel before system submission; the queued start must not revive a stopped utterance.
        XCTAssertTrue(speech.stop())
        XCTAssertTrue(speech.stop())
        await fulfillment(of: [cancelled], timeout: 5)
        XCTAssertEqual(count, 1)
        let resumed = expectation(description: "A new system utterance completes after immediate cancellation")
        resumed.assertForOverFulfill = true
        XCTAssertTrue(speech.speak("다음 테스트입니다.", language: "ko-KR", volume: 0) { spoken in
            XCTAssertTrue(spoken)
            resumed.fulfill()
        })
        await fulfillment(of: [resumed], timeout: 20)
        XCTAssertEqual(count, 1)
        let submittedStop = expectation(description: "Stop after submission settles before releasing playback")
        submittedStop.assertForOverFulfill = true
        var submittedCount = 0
        XCTAssertTrue(speech.speak(String(repeating: "제출 후 중지입니다. ", count: 40), language: "ko-KR", volume: 0) { spoken in
            submittedCount += 1
            XCTAssertFalse(spoken)
            submittedStop.fulfill()
        })
        // FIFO main-queue order places Stop after submission, including the pending didStart boundary.
        DispatchQueue.main.async {
            speech.stop()
            speech.stop()
        }
        await fulfillment(of: [submittedStop], timeout: 5)
        XCTAssertEqual(submittedCount, 1)
        try owner.release(token)
        released = true
        let next = try owner.reserve()
        defer { try? owner.release(next) }
        try owner.activate(next, category: .playback, mode: .spokenAudio)
        try owner.release(next)
    }
}
