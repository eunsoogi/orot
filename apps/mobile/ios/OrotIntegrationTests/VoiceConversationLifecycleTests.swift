import AVFoundation
import Foundation
@testable import Orot
import Speech
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

    func testDuplexCallbackBudgetSurvivesGenerationReset() {
        let budget = VoiceDuplexPendingPCM()
        let first = UUID(), second = UUID(), third = UUID()
        let limit = 8 * 1024 * 1024
        budget.reset(first)
        XCTAssertEqual(budget.reserve(limit, generation: first), .accepted)
        budget.reset(second)
        XCTAssertEqual(budget.reserve(1, generation: second), .overflow)
        XCTAssertEqual(budget.reserve(1, generation: first), .stale)
        budget.release(limit)
        budget.reset(third)
        XCTAssertEqual(budget.reserve(limit, generation: third), .accepted)
        budget.release(limit)
        XCTAssertEqual(budget.reserve(1, generation: third), .accepted)
        budget.release(1)
    }

    /// Feed checked-in synthetic PCM directly to the production recognizer, never an input node.
    /// This observes Apple recognition and request handoff, not microphone capture or acoustic AEC.
    @MainActor
    func testSyntheticPCMRecognitionContinuesAcrossTurns() async throws {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            XCTFail("Existing Speech permission is required; this diagnostic never requests permission")
            return
        }
        let fixture = try SpeechFixture.item("number", bundle: Bundle(for: Self.self))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        try XCTUnwrap(Data(base64Encoded: fixture.audio.base64)).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let recognition = VoiceDuplexRecognition()
        defer { recognition.stop() }
        var starts: [Int] = []
        var transcripts: [(Int, String)] = []
        var failure: Error?
        try recognition.start(locale: Locale(identifier: "ko-KR"), onSpeechStarted: { starts.append($0) },
                              onTranscript: { transcripts.append(($0, $1)) }, onFailure: { failure = $0 })
        for index in 0 ..< 2 {
            let file = try AVAudioFile(forReading: url)
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1024))
            while file.framePosition < file.length {
                try file.read(into: buffer)
                recognition.append(buffer)
                // Match source time so finalization can overlap the next live request realistically.
                let nanos = UInt64(Double(buffer.frameLength) / buffer.format.sampleRate * 1_000_000_000)
                try await Task.sleep(nanoseconds: nanos)
                if let failure {
                    throw failure
                }
            }
            let deadline = Date().addingTimeInterval(10)
            while transcripts.count <= index, failure == nil, Date() < deadline {
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            if let failure {
                throw failure
            }
            XCTAssertEqual(transcripts.count, index + 1, "Production recognition must emit each completed fixture turn")
            guard transcripts.count == index + 1 else { return }
            XCTAssertFalse(transcripts[index].1.isEmpty)
            XCTAssertTrue(starts.contains(transcripts[index].0))
        }
        XCTAssertGreaterThan(transcripts[1].0, transcripts[0].0)
        XCTAssertEqual(Set(starts).count, starts.count, "Each speech-start generation is emitted once")
        NSLog("OROT_DUPLEX_SYNTHETIC turns=%d syntheticPCM=true microphone=false networkAudio=false", transcripts.count)
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
