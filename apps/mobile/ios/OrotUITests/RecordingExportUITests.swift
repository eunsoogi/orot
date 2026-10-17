import XCTest

final class RecordingExportUITests: OrotFailFastTestCase {
    @MainActor private var ownedSources = Set<String>()

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testActualAudioShareDismissalCleansTemporaryFilesAndPreservesSource() throws {
        try ExportDismissalGeometryRegression.verify()
        try FormScrollGeometryRegression.verify()
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
        // Own both sources so the regression does not depend on another suite's saved recordings.
        let backgroundSource = try prepare(app)
        app.terminate()
        launch(app)
        addTeardownBlock { @MainActor in
            // XCTest may bypass defer on failure; collect before the earlier registered source cleanup.
            guard app.state != .notRunning else { return }
            let marker = UITestConditions.element(app, "navigation-test-observation")
            let attachment = XCTAttachment(data: Data(UITestConditions.text(marker).utf8), uniformTypeIdentifier: "public.json")
            attachment.name = "export-final-lifecycle-observation"
            attachment.lifetime = .keepAlways
            self.add(attachment)
        }
        defer {
            let observation = UITestConditions.element(app, "navigation-test-observation")
            let attachment = XCTAttachment(data: Data(UITestConditions.text(observation).utf8), uniformTypeIdentifier: "public.json")
            attachment.name = "export-lifecycle-observation"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
        let source = try prepare(app)
        // Authorization matrices, programmatic cancellation and restart residue have independent native tests.
        XCTAssertTrue(UITestConditions.text(element(app, "transcript-evidence-source-security")).contains("backup-excluded=false"))
        let marker = element(app, "navigation-test-observation")
        let session = try ExportDismissalGeometry.session(snapshot: UITestConditions.text(marker), nowMs: Date().timeIntervalSince1970 * 1000)
        tap(app, "recording-export-audio")
        let backgroundRow = app.buttons["recording-details-" + backgroundSource]
        let dismissal = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", "dismiss popup")).firstMatch
        var ready: (frame: CGRect, application: CGRect, snapshot: String, point: CGVector)?
        let presented = NSPredicate { _, _ in
            guard dismissal.exists else { return false }
            let frame = dismissal.frame
            let application = app.frame
            let snapshot = UITestConditions.text(marker)
            guard frame.width > 0, frame.height > 0,
                  backgroundRow.exists,
                  let point = try? ExportDismissalGeometry.point(snapshot: snapshot, session: session, applicationFrame: application,
                                                                 nowMs: Date().timeIntervalSince1970 * 1000,
                                                                 preferredFrame: backgroundRow.frame) else { return false }
            ready = (frame, application, snapshot, point)
            return true
        }
        // AX exposes the dismissal element before UIKit finishes presenting it. Await both presentation boundaries.
        XCTAssertEqual(UITestConditions.wait(for: [XCTNSPredicateExpectation(predicate: presented, object: nil)]), .completed)
        let geometry = try XCTUnwrap(ready)
        let frame = geometry.frame
        let point = geometry.point
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "actual-audio-share-sheet"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        // The AX dismissal frame covers the whole screen. Require a fresh safe corridor outside public presented geometry.
        // The audio path never consumes the synthetic cancellation hook.
        captureDismissalGeometry(app, "before-audio-dismissal-touch", frame: frame, point: point, snapshot: geometry.snapshot, applicationFrame: geometry.application)
        app.coordinate(withNormalizedOffset: .zero).withOffset(point).tap()
        captureDismissalGeometry(app, "after-audio-dismissal-touch", frame: frame, point: point)
        XCTAssertFalse(element(app, "recording-detail").exists, "Dismissing the native share must not select its obscured recording row")
        value(app, "recording-export-status", "내보내기를 취소했어요.")
        XCTAssertFalse(dismissal.exists)
        let result = try json(element(app, "recording-export-result"))
        XCTAssertEqual(result["residueCount"] as? Int, 0)
        XCTAssertEqual(result["sourceUnchanged"] as? Bool, true)
        XCTAssertEqual(result["cleaned"] as? Bool, true)
        ownedSources.remove(source)
    }

    @MainActor
    private func captureDismissalGeometry(_ app: XCUIApplication, _ stage: String, frame: CGRect, point: CGVector,
                                          snapshot: String? = nil, applicationFrame: CGRect? = nil)
    {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let text = snapshot ?? (marker.exists ? UITestConditions.text(marker) : "")
        let authorization = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
        // Bridge snapshots can lag. Keep their timestamp separate from the captured tap geometry, in UIKit points.
        let observation: [String: Any] = [
            "stage": stage, "atMs": Date().timeIntervalSince1970 * 1000,
            "applicationFrame": rectObservation(applicationFrame ?? app.frame), "dismissRegionFrameBeforeTouch": rectObservation(frame),
            "tapPointInApplication": ["x": point.dx, "y": point.dy],
            "authorizationSnapshotAtMs": authorization?["atMs"] ?? NSNull(), "observerID": authorization?["observerID"] ?? NSNull(),
            "presentations": authorization?["presentations"] ?? NSNull(),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: observation), let text = String(data: data, encoding: .utf8) {
            // Emit two compact stdout records alongside attachments; runner capture must be observed separately.
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
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = stage + "-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    private func rectObservation(_ rect: CGRect) -> [String: CGFloat] {
        ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    }

    @MainActor
    private func captureLifecycle(_ app: XCUIApplication, _ name: String) {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        let attachment = XCTAttachment(data: Data(UITestConditions.text(marker).utf8), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func launch(_ app: XCUIApplication) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "recording-export", "-OROT_TEST_EXPORT_OBSERVATION", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(element(app, "transcript-evidence-setup-status").waitForAppearance())
    }

    @MainActor
    private func prepare(_ app: XCUIApplication) throws -> String {
        value(app, "transcript-evidence-setup-status", "ready")
        let source = UITestConditions.text(element(app, "recording-export-source-id"))
        XCTAssertNotNil(UUID(uuidString: source))
        ownedSources.insert(source)
        return source
    }

    @MainActor
    private func json(_ target: XCUIElement) throws -> [String: Any] {
        let ready = NSPredicate { _, _ in UITestConditions.text(target).hasPrefix("{") }
        XCTAssertEqual(UITestConditions.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)]), .completed)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(UITestConditions.text(target).utf8)) as? [String: Any])
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = element(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
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
            // The actual completion message remains part of the production scroll content.
            FormUITestConditions.reveal(element(app, identifier), in: app, scrollID: "recording-controls-scroll")
        }
        UITestConditions.value(element(app, identifier), equals: expected)
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }
}
