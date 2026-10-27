import XCTest

/// Synthetic recordings and model replies enter the actual saved library, native navigation and production review route.
final class EncounterReviewUITests: OrotFailFastTestCase {
    private var readbackSequence = 0
    private var inputObservation: EncounterInputObservation?
    @MainActor
    func testSavedRecordingReviewRestoresWithoutAutomaticExtractionOrApproval() throws {
        let fixture = "test-persistence-" + UUID().uuidString.lowercased()
        let app = XCUIApplication()
        defer { clean(app) }
        launch(app, fixture: fixture, mode: "seed")
        openRecording(app, fixture: fixture)
        status(app, contains: "후보 찾기를 누르면")
        XCTAssertEqual(try report(app)["modelCalls"] as? Int, 0)
        XCTAssertEqual(try (report(app)["records"] as? [[String: Any]])?.count, 0)
        tap(app, "encounter-start")
        let evidence = reveal(app, "encounter-evidence-candidate-0-0", requireHittable: false)
        XCTAssertTrue(evidence.exists)
        status(app, contains: "근거와 충돌")
        let input = FormUITestConditions.multilineInput(app, identifier: "encounter-text-candidate-0")
        FormUITestConditions.replace(input, with: "회전 중 유지할 검토", in: app, scrollID: "navigation-route-scroll")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertEqual(input.value as? String, "회전 중 유지할 검토")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertEqual(input.value as? String, "회전 중 유지할 검토")
        XCTAssertEqual(try report(app)["modelCalls"] as? Int, 1)
        XCTAssertEqual(try (report(app)["records"] as? [[String: Any]])?.count, 0)
        app.terminate()
        launch(app, fixture: fixture, mode: "restore", observeInput: true)
        openRecording(app, fixture: fixture)
        status(app, contains: "근거와 충돌")
        XCTAssertEqual(try report(app)["modelCalls"] as? Int, 0)
        XCTAssertEqual(try (report(app)["records"] as? [[String: Any]])?.count, 0)
        let restoredInput = FormUITestConditions.multilineInput(app, identifier: "encounter-text-candidate-0")
        FormUITestConditions.replace(restoredInput, with: "사용자가 검토한 약물 언급", in: app, scrollID: "navigation-route-scroll", observeInput: inputObservation?.record)
        reveal(app, "encounter-save", avoiding: restoredInput).tap()
        status(app, contains: "저장했어요")
        app.terminate()
        launch(app, fixture: fixture, mode: "restore")
        openRecording(app, fixture: fixture)
        status(app, contains: "저장했어요")
        let readback = try report(app)
        XCTAssertEqual(readback["modelCalls"] as? Int, 0)
        let records = try XCTUnwrap(readback["records"] as? [[String: Any]])
        XCTAssertEqual(records.count, 2)
        for record in records {
            XCTAssertEqual((record["reviewState"] as? [String: Any])?["status"] as? String, "reviewed")
            let provenance = try XCTUnwrap(record["provenance"] as? [String: Any])
            XCTAssertEqual(provenance["origin"] as? String, "derived")
            XCTAssertEqual((provenance["source"] as? [String: Any])?["sourceName"] as? String, "speaker:unknown")
        }
        let evidenceRows = try XCTUnwrap(readback["evidence"] as? [[String: Any]])
        XCTAssertEqual(evidenceRows.count, 4)
        for span in evidenceRows {
            let provenance = try XCTUnwrap(span["provenance"] as? [String: Any])
            XCTAssertEqual((provenance["source"] as? [String: Any])?["sourceIdentifier"] as? String, fixture + ":ui-review:segment:r1")
            let locator = try XCTUnwrap(span["locator"] as? [String: Any])
            if locator["kind"] as? String == "audio_time_range" {
                XCTAssertEqual(locator["startMs"] as? Int, 100)
                XCTAssertEqual(locator["endMs"] as? Int, 2900)
            } else {
                XCTAssertEqual(locator["kind"] as? String, "text_range")
                XCTAssertTrue(try ["합성약 5 mg을 논의했어요.", "다음 주 기록을 확인해요."].contains(XCTUnwrap(span["text"] as? String)))
            }
        }
    }

    @MainActor
    func testDeniedTransmissionAndExplicitRejectionWriteNoRecords() throws {
        let fixture = "test-persistence-" + UUID().uuidString.lowercased()
        let app = XCUIApplication()
        defer { clean(app) }
        launch(app, fixture: fixture, mode: "remote")
        openRecording(app, fixture: fixture)
        tap(app, "encounter-start")
        let cancel = UITestConditions.element(app, "inference-disclosure-cancel")
        XCTAssertTrue(UITestConditions.exists(cancel))
        XCTAssertTrue(cancel.isHittable)
        cancel.tap()
        status(app, contains: "전송에 동의하지 않아")
        XCTAssertEqual(try report(app)["modelCalls"] as? Int, 0)
        XCTAssertEqual(try (report(app)["records"] as? [[String: Any]])?.count, 0)
        app.terminate()
        launch(app, fixture: fixture, mode: "seed")
        openRecording(app, fixture: fixture)
        tap(app, "encounter-start")
        tap(app, "encounter-deny")
        status(app, contains: "거절했어요")
        XCTAssertEqual(try (report(app)["records"] as? [[String: Any]])?.count, 0)
    }

    @MainActor
    func testTranscriptCorrectionPreventsStaleCandidateApproval() throws {
        let fixture = "test-persistence-" + UUID().uuidString.lowercased()
        let app = XCUIApplication()
        defer { clean(app) }
        launch(app, fixture: fixture, mode: "seed")
        openRecording(app, fixture: fixture)
        tap(app, "encounter-start")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "encounter-save")))
        tap(app, "transcript-edit-0", upward: true)
        let input = FormUITestConditions.multilineInput(app, identifier: "transcript-input-0")
        FormUITestConditions.replace(input, with: "수정한 전사", in: app, scrollID: "navigation-route-scroll")
        reveal(app, "transcript-save-0", avoiding: input).tap()
        UITestConditions.value(UITestConditions.element(app, "transcript-text-0"), equals: "수정한 전사")
        tap(app, "encounter-save")
        status(app, contains: "사용할 수 없어요")
        XCTAssertEqual(try (report(app)["records"] as? [[String: Any]])?.count, 0)
    }

    @MainActor
    func testDeletedRecordingPreventsLateCandidateApproval() throws {
        let fixture = "test-persistence-" + UUID().uuidString.lowercased()
        let app = XCUIApplication()
        defer { clean(app) }
        launch(app, fixture: fixture, mode: "seed")
        openRecording(app, fixture: fixture)
        tap(app, "encounter-start")
        attachStartDiagnostic(app)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "encounter-save")))
        let remove = UITestConditions.element(app, "encounter-probe-remove-source")
        XCTAssertTrue(remove.isHittable)
        remove.tap()
        UITestConditions.value(UITestConditions.element(app, "encounter-probe-report"), equals: "removed")
        tap(app, "encounter-save")
        status(app, contains: "사용할 수 없어요")
        XCTAssertEqual(try (report(app)["records"] as? [[String: Any]])?.count, 0)
    }

    @MainActor
    private func attachStartDiagnostic(_ app: XCUIApplication) {
        // Observe the real settled attempt before the original unbounded Save wait. Observation cannot fail its oracle.
        var diagnostic: [String: Any] = ["status": "UNKNOWN", "recordCount": "UNKNOWN", "modelCalls": "UNKNOWN", "failure": ["stage": "UNKNOWN", "category": "UNKNOWN"]]
        let button = UITestConditions.element(app, "encounter-probe-readback")
        if button.isHittable {
            readbackSequence += 1
            button.tap()
            let element = UITestConditions.element(app, "encounter-probe-report")
            let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "\"readback\":\(readbackSequence),"), object: element)
            if UITestConditions.wait(for: [loaded]) == .completed,
               let data = UITestConditions.text(element).data(using: .utf8),
               let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let snapshot = report["diagnostic"] as? [String: Any]
            {
                diagnostic = snapshot
            }
        }
        if let data = try? JSONSerialization.data(withJSONObject: diagnostic) {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = "encounter-review-start-diagnostic"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    @MainActor
    private func launch(_ app: XCUIApplication, fixture: String, mode: String, observeInput: Bool = false) {
        readbackSequence = 0
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "encounter-review", "-OROT_REVIEW_FIXTURE", fixture, "-OROT_REVIEW_MODE", mode]
        // The original restored edit opts in only when the runner environment explicitly requests it.
        inputObservation = observeInput && ProcessInfo.processInfo.environment["OROT_TEST_ENCOUNTER_INPUT_OBSERVATION"] == "1" ? EncounterInputObservation() : nil
        if let inputObservation {
            app.launchArguments += ["-OROT_TEST_ENCOUNTER_INPUT_OBSERVATION", inputObservation.run.uuidString]
        }
        app.launch()
        UITestConditions.value(UITestConditions.element(app, "encounter-probe-ready"), equals: "ready")
    }

    @MainActor
    private func openRecording(_ app: XCUIApplication, fixture: String) {
        let row = app.buttons.matching(identifier: "recording-details-\(fixture):ui-review").firstMatch
        FormUITestConditions.reveal(row, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(row.isHittable)
        row.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "encounter-review-panel")))
    }

    @MainActor
    private func reveal(_ app: XCUIApplication, _ id: String, upward: Bool = false, avoiding: XCUIElement? = nil, requireHittable: Bool = true) -> XCUIElement {
        let element = UITestConditions.element(app, id)
        FormUITestConditions.reveal(element, in: app, scrollID: "navigation-route-scroll", towardTop: upward, requireHittable: requireHittable, avoiding: avoiding)
        return element
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String, upward: Bool = false) {
        reveal(app, id, upward: upward).tap()
    }

    @MainActor
    private func status(_ app: XCUIApplication, contains expected: String) {
        let element = UITestConditions.element(app, "encounter-status")
        let updated = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", expected), object: element)
        XCTAssertEqual(UITestConditions.wait(for: [updated]), .completed)
        FormUITestConditions.reveal(element, in: app, scrollID: "navigation-route-scroll", towardTop: true, requireHittable: false)
        XCTAssertTrue(UITestConditions.text(element).contains(expected))
    }

    @MainActor
    private func report(_ app: XCUIApplication) throws -> [String: Any] {
        readbackSequence += 1
        let button = UITestConditions.element(app, "encounter-probe-readback")
        XCTAssertTrue(button.isHittable)
        button.tap()
        let element = UITestConditions.element(app, "encounter-probe-report")
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "\"readback\":\(readbackSequence),"), object: element)
        XCTAssertEqual(UITestConditions.wait(for: [loaded]), .completed)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(UITestConditions.text(element).utf8)) as? [String: Any])
    }

    @MainActor
    private func clean(_ app: XCUIApplication) {
        XCUIDevice.shared.orientation = .portrait
        let button = UITestConditions.element(app, "encounter-probe-cleanup")
        XCTAssertTrue(UITestConditions.exists(button))
        XCTAssertTrue(button.isHittable)
        button.tap()
        UITestConditions.value(UITestConditions.element(app, "encounter-probe-report"), equals: "cleaned")
        app.terminate()
    }
}
