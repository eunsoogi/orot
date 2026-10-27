import Foundation
@testable import Orot
import UIKit
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
        try addExportObservation(report, name: "recording-export-authorization")
    }

    @MainActor
    func testAutomaticPhoneTranscriptShareKeepsItsWindowAndFileUntilDismissal() throws {
        let operation = try RecordingExportFiles.transcriptFile(text: "synthetic share region")
        addTeardownBlock { try RecordingExportFiles.finish(operation.directory) }
        let originalWindow = try foregroundKeyWindow()
        let window = try UIWindow(windowScene: XCTUnwrap(originalWindow.windowScene))
        window.frame = originalWindow.frame
        let root = UIViewController()
        window.rootViewController = root
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            originalWindow.makeKeyAndVisible()
        }

        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve())
        let presentation = ActivityPresentation(items: [operation.file])
        let activity = presentation.controller
        // The policy records automatic creation intent; it does not infer modality from UIKit's getter.
        XCTAssertEqual(presentation.requestedStyle, .automatic)
        XCTAssertTrue(presentation.usesSystemManagedPhonePolicy(in: window))
        XCTAssertFalse(presentation.usesSystemManagedPhonePolicy(sourceIdiom: .pad, activityIdiom: .phone))
        XCTAssertFalse(presentation.usesSystemManagedPhonePolicy(sourceIdiom: .phone, activityIdiom: .pad))
        let explicit = ActivityPresentation(items: [operation.file], requestedStyle: .popover)
        XCTAssertFalse(explicit.usesSystemManagedPhonePolicy(sourceIdiom: .phone, activityIdiom: .phone))
        // Reverse teardown order preserves the live file until even a failed presentation has been dismissed.
        addTeardownBlock { @MainActor in
            if activity.presentingViewController != nil || activity.viewIfLoaded?.window != nil {
                await withCheckedContinuation { continuation in
                    activity.dismiss(animated: false) { continuation.resume() }
                }
            }
        }
        XCTAssertNil(anchor.apply(to: presentation))
        XCTAssertTrue(anchor.isCurrent)
        XCTAssertTrue(FileManager.default.fileExists(atPath: operation.file.path))
        let presented = expectation(description: "The automatic phone activity belongs to its initiating window")
        anchor.present(presentation, animated: false) { confirmed in
            XCTAssertTrue(confirmed)
            presented.fulfill()
        }
        wait(for: [presented], timeout: 5)
        XCTAssertTrue(anchor.presentationRelationshipMatches(activity))
        XCTAssertTrue(anchor.presentedControllerSharesWindow(activity))
        XCTAssertEqual(try String(contentsOf: operation.file, encoding: .utf8), "synthetic share region")

        let dismissed = expectation(description: "The activity closes before its protected copy is removed")
        activity.dismiss(animated: false) { dismissed.fulfill() }
        wait(for: [dismissed], timeout: 5)
        XCTAssertNil(activity.presentingViewController)
        XCTAssertNil(activity.viewIfLoaded?.window)
        XCTAssertTrue(FileManager.default.fileExists(atPath: operation.file.path))
        try RecordingExportFiles.finish(operation.directory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: operation.file.path))
        XCTAssertEqual(RecordingExportFiles.residueCount(), 0)
        root.view.removeFromSuperview()
        XCTAssertFalse(anchor.isCurrent)
        XCTAssertEqual(anchor.apply(to: presentation), false)
        var accepted: Bool?
        anchor.present(presentation, animated: false) { accepted = $0 }
        XCTAssertEqual(accepted, false)
    }

    @MainActor
    func testUnverifiedFullScreenPresentationRetainsExportUntilDismissal() throws {
        let operation = try RecordingExportFiles.transcriptFile(text: "share this transcript")
        addTeardownBlock { try RecordingExportFiles.finish(operation.directory) }
        var cleanupCount = 0
        let lifecycle = RecordingExportPresentationLifecycle {
            cleanupCount += 1
            do {
                try RecordingExportFiles.finish(operation.directory)
                return true
            } catch {
                XCTFail("Unexpected export cleanup error: \(error)")
                return false
            }
        }

        let originalWindow = try foregroundKeyWindow()
        let scene = try XCTUnwrap(originalWindow.windowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = originalWindow.frame
        let root = UIViewController()
        window.rootViewController = root
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            originalWindow.makeKeyAndVisible()
        }

        let child = UIViewController()
        root.addChild(child)
        child.view.frame = CGRect(x: 0, y: 0, width: window.bounds.width / 2, height: window.bounds.height)
        root.view.addSubview(child.view)
        child.didMove(toParent: root)
        let source = UIView(frame: CGRect(x: 8, y: 8, width: 12, height: 12))
        child.view.addSubview(source)

        // UIKit forwards this full-screen request from the partial child to the window root.
        let anchor = try XCTUnwrap(WindowPresentationAnchor.resolve(from: source))
        let modal = UIActivityViewController(activityItems: [operation.file], applicationActivities: nil)
        modal.modalPresentationStyle = .fullScreen
        var didPresent: Bool?
        let presented = expectation(description: "The full-screen controller remains in the source window")
        anchor.present(modal, animated: false) { result in
            didPresent = result
            presented.fulfill()
        }
        wait(for: [presented], timeout: 5)

        XCTAssertEqual(didPresent, true)
        XCTAssertTrue(modal.presentingViewController === root)
        XCTAssertTrue(root.presentedViewController === modal)
        XCTAssertTrue(modal.viewIfLoaded?.window === window)
        // UIKit removes the covered child hierarchy after a full-screen presentation completes.
        XCTAssertNil(source.window)

        var unavailableRejections = 0
        let disposition = lifecycle.completePresentation(
            didPresent: false,
            controllerIsLive: modal.presentingViewController != nil || modal.viewIfLoaded?.window != nil,
            rejectUnavailable: { unavailableRejections += 1 },
        )
        XCTAssertEqual(disposition, .liveButUnverified)
        XCTAssertEqual(cleanupCount, 0)
        XCTAssertEqual(unavailableRejections, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: operation.file.path))

        let dismissed = expectation(description: "The full-screen controller is dismissed")
        modal.dismiss(animated: false) { dismissed.fulfill() }
        wait(for: [dismissed], timeout: 5)

        XCTAssertTrue(lifecycle.finishIfNeeded())
        XCTAssertEqual(cleanupCount, 1)
        XCTAssertTrue(lifecycle.finishIfNeeded())
        XCTAssertEqual(cleanupCount, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: operation.file.path))
        XCTAssertEqual(RecordingExportFiles.residueCount(), 0)

        let unavailableOperation = try RecordingExportFiles.transcriptFile(text: "unavailable share")
        addTeardownBlock { try RecordingExportFiles.finish(unavailableOperation.directory) }
        var unavailableCleanupCount = 0
        var failureRejections = 0
        let unavailableLifecycle = RecordingExportPresentationLifecycle {
            unavailableCleanupCount += 1
            do {
                try RecordingExportFiles.finish(unavailableOperation.directory)
                return true
            } catch {
                XCTFail("Unexpected unavailable-export cleanup error: \(error)")
                return false
            }
        }
        let unavailableController = UIViewController()
        let unavailableDisposition = unavailableLifecycle.completePresentation(
            didPresent: false,
            controllerIsLive: unavailableController.presentingViewController != nil || unavailableController.viewIfLoaded?.window != nil,
            rejectUnavailable: { failureRejections += 1 },
        )
        XCTAssertEqual(unavailableDisposition, .unavailable)
        XCTAssertEqual(unavailableCleanupCount, 1)
        XCTAssertEqual(failureRejections, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: unavailableOperation.file.path))
    }

    @MainActor
    private func foregroundKeyWindow() throws -> UIWindow {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            .filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0 }
        XCTAssertEqual(windows.count, 1)
        return try XCTUnwrap(windows.first)
    }

    private func addExportObservation(_ observation: Any, name: String) throws {
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: observation), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways // Preserve diagnostics when the unchanged app assertion fails.
        add(attachment)
    }
}
