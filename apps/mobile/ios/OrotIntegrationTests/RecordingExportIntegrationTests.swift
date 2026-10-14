import Foundation
@testable import Orot
import XCTest

final class RecordingExportIntegrationTests: OrotFailFastTestCase {
    func testUtf8TranscriptCopyIsExcludedFromBackupAndRemovedAfterExport() throws {
        let text = "합성 전사 café🙂\n"
        let operation = try RecordingExportFiles.transcriptFile(text: text)
        addTeardownBlock { try RecordingExportFiles.finish(operation.directory) }
        XCTAssertEqual(try Data(contentsOf: operation.file), Data(text.utf8))
        XCTAssertEqual(try operation.file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        XCTAssertThrowsError(try RecordingExportFiles.transcriptFile(text: text)) { error in
            guard case RecordingExportFailure.busy = error else { return XCTFail("Unexpected export slot error: \(error)") }
        }
        try RecordingExportFiles.finish(operation.directory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: operation.directory.path))
        XCTAssertEqual(RecordingExportFiles.residueCount(), 0)
        XCTAssertThrowsError(try RecordingExportFiles.transcriptFile(text: " \n"))
    }

    func testAudioCopyPreservesSourceBytesAndSyntheticAuthorizationGuardrails() throws {
        let fixture = try SpeechFixture.item("medication-name", bundle: Bundle(for: Self.self))
        let source = try RecordingFileSecurity.installSyntheticTranscriptionFixture(base64: fixture.audio.base64)
        let identifier = try XCTUnwrap(source["id"] as? String)
        addTeardownBlock { try RecordingFileSecurity.removeSyntheticTranscriptionFixture(id: identifier) }
        let report = try RecordingFileSecurity.simulatorExportAuthorizationReport(id: identifier)
        for field in ["registeredFixtureAllowed", "missingIDRejected", "unregisteredFileUsesStrictPath", "discardedRegistrationUsesStrictPath", "backupExclusionStillRequired"] {
            XCTAssertEqual(report[field], true, field)
        }
        XCTAssertTrue(RecordingExportFiles.temporaryBackupExclusionIsMandatory())
        let original = try XCTUnwrap(Data(base64Encoded: fixture.audio.base64))
        let operation = try RecordingExportFiles.audioCopy(recordingID: identifier)
        addTeardownBlock { try RecordingExportFiles.finish(operation.directory) }
        XCTAssertEqual(try Data(contentsOf: operation.file), original)
        XCTAssertEqual(try operation.file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        try RecordingExportFiles.finish(operation.directory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: operation.directory.path))
        XCTAssertEqual(RecordingExportFiles.residueCount(), 0)
        XCTAssertTrue(try RecordingFileSecurity.isSyntheticTranscriptionFixtureUnchanged(id: identifier))
        // This one-shot Simulator hook is separate from the UI test's actual UIKit outside-tap cancellation.
        RecordingExportFiles.armCancellation()
        XCTAssertTrue(RecordingExportFiles.consumeSimulatorCancellation())
        XCTAssertFalse(RecordingExportFiles.consumeSimulatorCancellation())
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: report), uniformTypeIdentifier: "public.json")
        attachment.name = "recording-export-native-authorization"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
