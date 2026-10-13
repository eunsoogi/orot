import XCTest

final class TranscriptEvidenceUITests: XCTestCase {
    @MainActor private var ownedSource: String?
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testReviewCorrectionHistoryPlaybackAndDeletionSurviveRelaunch() throws {
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
        tap(app, "transcript-evidence-open")
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
        XCTAssertTrue(playback.waitForExistence(timeout: 30))
        let data = try XCTUnwrap(UITestConditions.text(playback).data(using: .utf8))
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Double])
        XCTAssertEqual(report["startMs"], 250)
        XCTAssertEqual(report["endMs"], 1801)
        XCTAssertLessThanOrEqual(try abs(XCTUnwrap(report["actualStartMs"]) - 250), 50)

        tap(app, "transcript-edit-0")
        let input = reveal(app, "transcript-input-0")
        input.tap()
        // Focusing changes the keyboard viewport. Recheck the real input frame before opening its edit menu.
        _ = reveal(app, "transcript-input-0")
        let viewport = element(app, "recording-controls-scroll")
        let offset = CGVector(dx: input.frame.midX - viewport.frame.minX,
                              dy: input.frame.midY - viewport.frame.minY)
        // Select the original text through the native editor before entering a replacement.
        viewport.coordinate(withNormalizedOffset: .zero).withOffset(offset).press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 2) {
            app.menuItems["Select All"].tap()
        } else {
            input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: original.count))
        }
        let correction = "사용자가 확인한 전사 수정"
        input.typeText(correction)
        UITestConditions.value(input, equals: correction)
        tap(app, "transcript-save-0")
        value(app, "transcript-evidence-correction-status", "saved")
        XCTAssertEqual(text(app, "transcript-text-0"), correction)
        let history = text(app, "transcript-history-0-1", upward: true)
        XCTAssertTrue(history.contains("이전 버전 1:"))
        XCTAssertTrue(history.contains(original))
        XCTAssertEqual(text(app, "transcript-review-0", upward: true), "수정됨 · 다시 확인 필요")
        XCTAssertTrue(text(app, "transcript-stale-artifacts", upward: true).contains("1개"))
        tap(app, "transcript-evidence-verify-memory")
        value(app, "transcript-evidence-memory-status", "passed")
        tap(app, "transcript-evidence-seed-deletion")
        value(app, "transcript-evidence-deletion-seed-status", "seeded")
        tap(app, "recording-detail-delete", upward: true)
        let confirmation = app.alerts["녹음을 삭제할까요?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 10))
        confirmation.buttons["취소"].tap()
        XCTAssertTrue(element(app, "recording-library-item-\(source)").exists)
        tap(app, "recording-detail-delete", upward: true)
        XCTAssertTrue(confirmation.waitForExistence(timeout: 10))
        confirmation.buttons["삭제"].tap()
        let absent = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element(app, "recording-library-item-\(source)"))
        XCTAssertEqual(XCTWaiter.wait(for: [absent], timeout: 30), .completed)
        app.terminate()
        app.launchArguments += ["-OROT_TRANSCRIPT_DELETION_VERIFY_SOURCE_ID", source]
        app.launch()
        value(app, "transcript-evidence-deletion-status", "passed")
        XCTAssertFalse(element(app, "recording-library-item-\(source)").exists)
        ownedSource = nil
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func reveal(_ app: XCUIApplication, _ id: String, upward: Bool = false) -> XCUIElement {
        let target = element(app, id)
        let scroll = element(app, "recording-controls-scroll")
        for _ in 0 ..< 12 {
            if unobscured(app, target) {
                return target
            }
            // Stay inside the production screen's bounded scroll viewport, above the keyboard.
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: upward ? 0.15 : 0.35))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: upward ? 0.35 : 0.15))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(unobscured(app, target), app.debugDescription)
        return target
    }

    @MainActor
    private func unobscured(_ app: XCUIApplication, _ target: XCUIElement) -> Bool {
        guard target.exists, target.isHittable else { return false }
        let frame = target.frame
        let keyboard = app.keyboards.firstMatch
        let bottom = keyboard.exists ? min(app.frame.maxY, keyboard.frame.minY) : app.frame.maxY
        // AX reported the covered save button hittable while the failure video showed it below the keyboard.
        return !frame.isEmpty && frame.minY >= app.frame.minY && frame.maxY <= bottom
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
