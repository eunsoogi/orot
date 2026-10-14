import Foundation
@testable import Orot
import XCTest

final class SpeechIntegrationTests: OrotFailFastTestCase {
    /// Each operation uses the production engine and its existing 120-second service deadline.
    /// App launch, model readiness and recognition remain separate from editor/export UI assertions.
    func testMedicationFixture() async throws {
        try await verifyFixture("medication-name")
    }

    func testNumberFixture() async throws {
        try await verifyFixture("number")
    }

    func testNegationFixture() async throws {
        try await verifyFixture("negation")
    }

    func testInvalidLanguageFailsBeforeRequestingNativeServices() async {
        do {
            _ = try await SpeechTranscriptionEngine.transcribe(["language": "en-US"])
            XCTFail("An unsupported language must not start transcription")
        } catch let failure as SpeechTranscriptionFailure {
            XCTAssertEqual(failure.code, "UNSUPPORTED_LANGUAGE")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testMissingAudioFailsBeforeRequestingNativeServices() async {
        do {
            _ = try await SpeechTranscriptionEngine.transcribe(["language": "ko-KR"])
            XCTFail("Missing audio must be rejected")
        } catch let failure as SpeechTranscriptionFailure {
            XCTAssertEqual(failure.code, "INVALID_AUDIO")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func verifyFixture(_ id: String) async throws {
        let fixture = try SpeechFixture.item(id, bundle: Bundle(for: Self.self))
        let started = Date()
        let availability = await SpeechTranscriptionEngine.availability(language: "ko-KR")
        NSLog("OROT_NATIVE_SPEECH_AVAILABILITY id=%@ value=%@", id, String(describing: availability.dictionary))
        let result = try await SpeechTranscriptionEngine.transcribe([
            "language": "ko-KR",
            "audioBase64": fixture.audio.base64,
            "mediaType": fixture.audio.mediaType,
            "syntheticFixture": true,
        ])
        let text = try XCTUnwrap(result["text"] as? String)
        XCTAssertFalse(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        XCTAssertEqual(result["language"] as? String, "ko-KR")
        let engine = try XCTUnwrap(result["engine"] as? String)
        XCTAssertTrue(["speech_transcriber", "dictation_transcriber", "on_device_speech_recognizer"].contains(engine))
        let segments = try XCTUnwrap(result["segments"] as? [[String: Any]])
        XCTAssertFalse(segments.isEmpty)
        for segment in segments {
            let start = try XCTUnwrap(segment["startSeconds"] as? Double)
            let end = try XCTUnwrap(segment["endSeconds"] as? Double)
            XCTAssertGreaterThanOrEqual(start, 0)
            XCTAssertGreaterThan(end, start)
            XCTAssertLessThanOrEqual(end, fixture.audio.durationSeconds + 0.1)
        }
        let observation: [String: Any] = [
            "id": id, "inputSha256": fixture.audio.sha256,
            "expectedText": fixture.expectedText, "recognizedText": text,
            "engine": engine, "segments": segments,
            "elapsedSeconds": Date().timeIntervalSince(started),
            "syntheticAudio": true, "nativeResult": true,
        ]
        let data = try JSONSerialization.data(withJSONObject: observation, options: [.sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "native-korean-\(id)"
        attachment.lifetime = .keepAlways
        add(attachment)
        NSLog("OROT_NATIVE_SPEECH_RESULT %@", String(decoding: data, as: UTF8.self))
    }
}
