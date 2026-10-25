import XCTest

final class TranscriptEvidenceUITests: OrotFailFastTestCase {
    @MainActor private var ownedSource: String?
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testNativeReviewHistoryPlaybackAndDeleteConfirmation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "transcript-evidence"]
        addTeardownBlock { @MainActor in
            guard let source = self.ownedSource else { return }
            app.terminate()
            app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "transcript-evidence", "-OROT_TEST_TRANSCRIPT_CLEANUP_ID", source]
            app.launch()
            UITestConditions.value(UITestConditions.element(app, "transcript-evidence-setup-status"), equals: "cleaned")
            app.terminate()
        }
        app.launch()
        defer { app.terminate() }
        value(app, "transcript-evidence-setup-status", "ready")
        let source = UITestConditions.text(element(app, "transcript-evidence-source-id"))
        ownedSource = source
        XCTAssertNotNil(UUID(uuidString: source))
        tap(app, "recording-details-\(source)")
        tap(app, "transcript-create")
        let original = text(app, "transcript-text-0")
        XCTAssertFalse(original.isEmpty)
        XCTAssertEqual(text(app, "transcript-review-0"), "검토 전 초안")
        XCTAssertFalse(element(app, "transcript-engine-0").exists)
        XCTAssertFalse(element(app, "transcript-runtime-0").exists)
        XCTAssertEqual(text(app, "transcript-range-0"), "00:00.250–00:01.801")
        tap(app, "transcript-play-0")
        let playback = element(app, "transcript-evidence-playback-result")
        XCTAssertTrue(playback.waitForAppearance())
        let data = try XCTUnwrap(UITestConditions.text(playback).data(using: .utf8))
        let report = try JSONDecoder().decode(TranscriptPlaybackReport.self, from: data)
        XCTAssertEqual(report.startMs, 250)
        XCTAssertEqual(report.endMs, 1801)
        XCTAssertLessThanOrEqual(abs(report.actualStartMs - 250), 50)
        XCTAssertEqual(report.completion, "completed")
        XCTAssertEqual(report.actualEndMs, 1801)

        tap(app, "transcript-edit-0")
        let input = FormUITestConditions.multilineInput(app, identifier: "transcript-input-0")
        let correction = "사용자가 확인한 전사 수정"
        // Exercise native keyboard editing and exact value readback through the real transcript input.
        FormUITestConditions.replace(input, with: correction, in: app, scrollID: "recording-controls-scroll")
        // Reveal beside the active editor so a keyboard-covered Save scrolls the form, not the text view.
        let save = element(app, "transcript-save-0")
        FormUITestConditions.reveal(save, in: app, scrollID: "recording-controls-scroll", avoiding: input)
        save.tap()
        value(app, "transcript-evidence-correction-status", "saved")
        XCTAssertEqual(text(app, "transcript-text-0"), correction)
        let history = text(app, "transcript-history-0-1", upward: true)
        XCTAssertTrue(history.contains("이전 버전 1:"))
        XCTAssertTrue(history.contains(original))
        XCTAssertEqual(text(app, "transcript-review-0", upward: true), "수정됨 · 다시 확인 필요")
        XCTAssertTrue(text(app, "transcript-stale-artifacts", upward: true).contains("1개"))
        // Full memory/vector invalidation and new-process readback belong to RecordingPersistenceIntegrationTests.
        tap(app, "recording-detail-delete", upward: true)
        let confirmation = app.alerts["녹음을 삭제할까요?"]
        XCTAssertTrue(confirmation.waitForAppearance())
        confirmation.buttons["취소"].tap()
        XCTAssertTrue(element(app, "recording-library-item-\(source)").exists)
        tap(app, "recording-detail-delete", upward: true)
        XCTAssertTrue(confirmation.waitForAppearance())
        confirmation.buttons["삭제"].tap()
        let absent = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element(app, "recording-library-item-\(source)"))
        XCTAssertEqual(UITestConditions.wait(for: [absent]), .completed)
        ownedSource = nil
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        // Recording rows expose a real button role; avoid scanning every node type for that action.
        if id.hasPrefix("recording-details-") {
            return app.buttons.matching(identifier: id).firstMatch
        }
        return UITestConditions.element(app, id)
    }

    @MainActor
    private func reveal(_ app: XCUIApplication, _ id: String, upward: Bool = false) -> XCUIElement {
        let target = element(app, id)
        // Use the measured scroll/keyboard viewport and app-anchored gestures shared by native form tests.
        // Visibility, hit testing and the final native tap remain required after scrolling.
        FormUITestConditions.reveal(target, in: app, scrollID: "recording-controls-scroll", towardTop: upward)
        return target
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String, upward: Bool = false) {
        reveal(app, id, upward: upward).tap()
    }

    @MainActor
    private func text(_ app: XCUIApplication, _ id: String, upward: Bool = false) -> String {
        UITestConditions.text(reveal(app, id, upward: upward))
    }

    @MainActor
    private func value(_ app: XCUIApplication, _ id: String, _ expected: String) {
        UITestConditions.value(element(app, id), equals: expected)
    }
}

/// Decode numeric playback evidence strictly while retaining the native string completion reason.
/// Missing or nonnumeric clocks must fail rather than disappearing in a heterogeneous dictionary cast.
struct TranscriptPlaybackReport: Decodable {
    let startMs: Double
    let endMs: Double
    let actualStartMs: Double
    let actualEndMs: Double
    let completion: String
}
