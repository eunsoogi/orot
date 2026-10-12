import XCTest

final class RecordingExportUITests: XCTestCase {
    @MainActor private var ownedSources = Set<String>()

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testShareCancellationCleansTemporaryFilesAndPreservesSourceAfterRestart() throws {
        let app = XCUIApplication()
        addTeardownBlock { @MainActor in
            // A failed share assertion must leave no recording from this case; never reset another case's storage.
            for source in self.ownedSources {
                app.terminate()
                app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "transcript-evidence", "-OROT_TEST_TRANSCRIPT_CLEANUP_ID", source]
                app.launch()
                self.value(app, "transcript-evidence-setup-status", "cleaned")
            }
            app.terminate()
        }
        launch(app)
        defer { app.terminate() }
        try prepare(app)
        tap(app, "recording-export-arm-simulated-cancel")
        // Observe the native arm response before export. A tap alone cannot prove the Promise completed.
        value(app, "recording-export-cancellation-status", "armed")
        tap(app, "recording-export-transcript")
        value(app, "recording-export-status", "내보내기를 취소했어요.")
        tap(app, "recording-export-read-residue")
        value(app, "recording-export-residue-count", "0")
        tap(app, "transcript-evidence-cleanup")
        value(app, "transcript-evidence-setup-status", "cleaned")
        ownedSources.removeAll()

        tap(app, "recording-export-prepare-residue")
        value(app, "recording-export-residue-count", "1")
        app.terminate()
        launch(app)
        tap(app, "recording-export-read-residue")
        value(app, "recording-export-residue-count", "1")
        try prepare(app)
        let reportElement = element(app, "recording-export-authorization-probe")
        let report = try json(reportElement)
        for field in ["registeredFixtureAllowed", "missingIDRejected", "unregisteredFileUsesStrictPath", "discardedRegistrationUsesStrictPath", "backupExclusionStillRequired"] {
            XCTAssertEqual(report[field] as? Bool, true, field)
        }
        XCTAssertTrue(UITestConditions.text(element(app, "transcript-evidence-source-security")).contains("backup-excluded=false"))
        tap(app, "recording-export-audio")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "actual-audio-share-sheet"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let dismissal = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", "dismiss popup")).firstMatch
        XCTAssertTrue(dismissal.waitForExistence(timeout: 30), app.debugDescription)
        let frame = dismissal.frame
        XCTAssertGreaterThan(frame.width, 0)
        XCTAssertGreaterThan(frame.height, 0)
        let point = CGVector(dx: frame.midX - app.frame.minX,
                             dy: frame.minY + frame.height * 0.2 - app.frame.minY)
        // UIKit receives an actual outside touch; the audio path never consumes the synthetic cancellation hook.
        app.coordinate(withNormalizedOffset: .zero).withOffset(point).tap()
        value(app, "recording-export-status", "내보내기를 취소했어요.")
        XCTAssertFalse(dismissal.exists)
        tap(app, "recording-export-read-residue")
        value(app, "recording-export-residue-count", "0")
        value(app, "recording-export-source-status", "unchanged")
        tap(app, "transcript-evidence-cleanup")
        value(app, "transcript-evidence-setup-status", "cleaned")
        ownedSources.removeAll()
    }

    @MainActor
    private func launch(_ app: XCUIApplication) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "recording-export", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(element(app, "transcript-evidence-open").waitForExistence(timeout: 30))
    }

    @MainActor
    private func prepare(_ app: XCUIApplication) throws {
        tap(app, "transcript-evidence-open")
        value(app, "transcript-evidence-setup-status", "ready")
        let source = UITestConditions.text(element(app, "recording-export-source-id"))
        XCTAssertNotNil(UUID(uuidString: source))
        ownedSources.insert(source)
    }

    @MainActor
    private func json(_ target: XCUIElement) throws -> [String: Any] {
        let ready = NSPredicate { _, _ in UITestConditions.text(target).hasPrefix("{") }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 30), .completed)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(UITestConditions.text(target).utf8)) as? [String: Any])
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = element(app, identifier)
        XCTAssertTrue(target.waitForExistence(timeout: 30), app.debugDescription)
        if !target.isHittable {
            let scroll = element(app, "recording-controls-scroll")
            for _ in 0 ..< 12 {
                if target.isHittable {
                    break
                }
                scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65)).press(forDuration: 0.05,
                                                                                           thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
            }
        }
        XCTAssertTrue(target.isHittable, app.debugDescription)
        target.tap()
    }

    @MainActor
    private func value(_ app: XCUIApplication, _ identifier: String, _ expected: String) {
        UITestConditions.value(element(app, identifier), equals: expected)
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }
}
