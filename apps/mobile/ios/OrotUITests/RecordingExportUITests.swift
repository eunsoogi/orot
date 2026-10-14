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
        addTeardownBlock { @MainActor in
            // XCTest may bypass defer on failure; collect before the earlier registered source cleanup.
            guard app.state != .notRunning else { return }
            let marker = UITestConditions.element(app, "native-navigation-observation")
            let attachment = XCTAttachment(data: Data(UITestConditions.text(marker).utf8), uniformTypeIdentifier: "public.json")
            attachment.name = "export-final-lifecycle-observation"
            attachment.lifetime = .keepAlways
            self.add(attachment)
        }
        defer {
            let observation = UITestConditions.element(app, "native-navigation-observation")
            let attachment = XCTAttachment(data: Data(UITestConditions.text(observation).utf8), uniformTypeIdentifier: "public.json")
            attachment.name = "export-lifecycle-observation"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
        try prepare(app)
        tap(app, "recording-export-arm-simulated-cancel")
        // Observe the native arm response before export. A tap alone cannot prove the Promise completed.
        value(app, "recording-export-cancellation-status", "armed")
        tap(app, "recording-export-transcript")
        value(app, "recording-export-status", "내보내기를 취소했어요.")
        captureLifecycle(app, "export-synthetic-cancellation-observation")
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
        // Preserve the candidate backdrop point; geometry observations check its relation to the presented content.
        // The audio path never consumes the synthetic cancellation hook.
        captureDismissalGeometry(app, "before-audio-dismissal-touch", frame: frame, point: point)
        app.coordinate(withNormalizedOffset: .zero).withOffset(point).tap()
        captureDismissalGeometry(app, "after-audio-dismissal-touch", frame: frame, point: point)
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
    private func captureDismissalGeometry(_ app: XCUIApplication, _ stage: String, frame: CGRect, point: CGVector) {
        let marker = UITestConditions.element(app, "native-navigation-observation")
        let snapshot = marker.exists ? UITestConditions.text(marker) : ""
        let native = (try? JSONSerialization.jsonObject(with: Data(snapshot.utf8))) as? [String: Any]
        // Bridge snapshots can lag. Keep their timestamp separate from the captured tap geometry, in UIKit points.
        let observation: [String: Any] = [
            "stage": stage, "atMs": Date().timeIntervalSince1970 * 1000,
            "applicationFrame": rectObservation(app.frame), "dismissRegionFrameBeforeTouch": rectObservation(frame),
            "tapPointInApplication": ["x": point.dx, "y": point.dy],
            "nativeSnapshotAtMs": native?["atMs"] ?? NSNull(), "observerID": native?["observerID"] ?? NSNull(),
            "presentations": native?["presentations"] ?? NSNull(),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: observation), let text = String(data: data, encoding: .utf8) {
            // Two small records remain readable even when Xcode cannot finalize its result bundle.
            print("OROT_TEST_EXPORT_DISMISSAL \(text)")
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = stage
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        if stage == "after-audio-dismissal-touch" {
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = stage
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
    }

    private func rectObservation(_ rect: CGRect) -> [String: CGFloat] {
        ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    }

    @MainActor
    private func captureLifecycle(_ app: XCUIApplication, _ name: String) {
        let marker = UITestConditions.element(app, "native-navigation-observation")
        let attachment = XCTAttachment(data: Data(UITestConditions.text(marker).utf8), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func launch(_ app: XCUIApplication) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "recording-export", "-OROT_TEST_EXPORT_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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
        if ["recording-export-transcript", "recording-export-audio"].contains(identifier) {
            FormUITestConditions.reveal(target, in: app, scrollID: "recording-controls-scroll")
        }
        XCTAssertTrue(target.isHittable, app.debugDescription)
        let frame = target.frame
        XCTAssertTrue(!frame.isEmpty && app.frame.contains(frame), target.debugDescription)
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX - app.frame.minX,
                                                                        dy: frame.midY - app.frame.minY)).tap()
    }

    @MainActor
    private func value(_ app: XCUIApplication, _ identifier: String, _ expected: String) {
        if identifier == "recording-export-status" {
            // The fixed diagnostic controls leave a short viewport on SE. The result follows both export buttons and can be clipped from AX.
            FormUITestConditions.reveal(element(app, identifier), in: app, scrollID: "recording-controls-scroll")
        }
        UITestConditions.value(element(app, identifier), equals: expected)
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }
}
