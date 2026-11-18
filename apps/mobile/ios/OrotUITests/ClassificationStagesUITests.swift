import XCTest

/// Real settings approval and manually released synthetic batches expose stable native stage boundaries.
extension AppointmentConsentUITests {
    @MainActor
    func testApprovedBatchesExposeMeasuredProgressAndAllResultPages() {
        let app = XCUIApplication()
        let fixture = ClassificationConsentUITestSupport.launch(app, extra: ["-OROT_TEST_CLASSIFICATION_STAGES", "YES"])
        defer { ClassificationConsentUITestSupport.cleanup(app, fixture: fixture, testCase: self) }
        ClassificationConsentUITestSupport.assertBlocked(app, testCase: self)
        XCTAssertTrue(node(app, "medical-appointment-confirmation").exists)
        ClassificationConsentUITestSupport.openSettingsChoice(app, testCase: self)
        ClassificationConsentUITestSupport.assertSettingsControls(app, testCase: self)
        tap(app, "provider-selection-confirm")
        XCTAssertTrue(node(app, "calendar-current-model").waitForAppearance())
        tap(app, "classification-close-settings")
        assertStageActions(app)
        DisclosureLayoutUITestObservations.startClassification(app, in: self)

        assertHeldProgress(app, percent: 0, calls: 1, saving: false)
        tap(app, "classification-release-response")
        assertHeldProgress(app, percent: 88, calls: 2, saving: false)
        tap(app, "classification-release-response")
        assertHeldProgress(app, percent: 100, calls: 2, saving: true)
        tap(app, "classification-release-response")
        XCTAssertTrue(node(app, "medical-appointment-results").waitForAppearance())
        UITestConditions.value(node(app, "calendar-classification-synthetic-calendar-save"), equals: "syntheticCalendarSave=confirmed")
        XCTAssertFalse(node(app, "medical-appointment-progress").exists)
        XCTAssertFalse(node(app, "medical-appointment-confirmation").exists)
        let pages = readAllResultPages(app)
        let readable = pages.joined().filter { !$0.isWhitespace }
        // Indexed segments make loss/repetition observable even when native line breaks split a long title.
        let title = (1 ... 30).map { "합성 긴 진료 예약 \($0)" }.joined(separator: " ").filter { !$0.isWhitespace }
        XCTAssertTrue(readable.contains(title), "Every segment of the long synthetic title must remain reachable")
        for index in 2 ... 9 {
            XCTAssertTrue(readable.contains("합성진료예약\(index)"), "Missing synthetic result \(index)")
        }
        XCTAssertFalse(readable.contains("합성진료예약10"))
        XCTAssertTrue(readable.contains("분류근거:의료방문·검사일정"))
        XCTAssertEqual(node(app, "calendar-classification-synthetic-provider-calls").label, "syntheticProviderCalls=2")
        // Going back traverses the same native pages, not a second request or a synthetic page counter.
        for expected in pages.dropLast().reversed() {
            tap(app, "medical-appointment-previous-result")
            waitForText(node(app, "classification-page-text"), expected: expected)
            assertStageActions(app)
        }
        XCTAssertFalse(node(app, "medical-appointment-previous-result").isEnabled)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        NavigationGeometryUITestConditions.captureScreen(app, name: "classification-long-result-returned", testCase: self)
    }

    @MainActor
    private func assertHeldProgress(_ app: XCUIApplication, percent: Int, calls: Int, saving: Bool) {
        let phase = saving ? "save" : "model"
        let gate = node(app, "classification-release-response")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            gate.exists && gate.isEnabled && gate.label == "Release synthetic \(phase)"
                && UITestConditions.text(self.node(app, "calendar-classification-synthetic-provider-calls")) == "syntheticProviderCalls=\(calls)"
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        let label = saving ? "분류한 일정을 저장하고 있어요." : "일정 분류 중"
        let progress = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND value == %@", label, "\(percent)%")).firstMatch
        XCTAssertTrue(progress.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(progress.frame.isEmpty)
        XCTAssertTrue(app.frame.contains(progress.frame))
        XCTAssertFalse(node(app, "medical-appointment-results").exists)
        XCTAssertFalse(node(app, "medical-appointment-confirmation").exists)
        XCTAssertFalse(node(app, "calendar-classification-synthetic-calendar-save").exists)
        XCTAssertFalse(node(app, "classification-page-text").exists)
        XCTAssertFalse(node(app, "inference-disclosure-sheet").exists)
        XCTAssertGreaterThanOrEqual(gate.frame.height, 44)
        XCTAssertTrue(gate.isHittable)
        // Evidence includes fixture controls: their 44pt gate and diagnostic text reduce the product stage height.
        NavigationGeometryUITestConditions.captureScreen(app, name: "classification-progress-\(percent)", testCase: self)
    }

    @MainActor
    private func readAllResultPages(_ app: XCUIApplication) -> [String] {
        var pages: [String] = []
        for _ in 0 ..< 256 {
            let page = node(app, "classification-page-text")
            XCTAssertTrue(page.waitForAppearance())
            let text = UITestConditions.text(page)
            XCTAssertFalse(text.isEmpty)
            let viewport = node(app, "classification-text-viewport")
            XCTAssertTrue(viewport.frame.insetBy(dx: -1, dy: -1).contains(page.frame), app.debugDescription)
            assertStageActions(app)
            pages.append(text)
            let next = node(app, "medical-appointment-next-result")
            if !next.isEnabled {
                return pages
            }
            next.tap()
            let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                UITestConditions.text(page) != text
            }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed)
        }
        XCTFail("Synthetic nine-result pagination did not terminate; refusing an unbounded native journey")
        return pages
    }

    @MainActor
    private func assertStageActions(_ app: XCUIApplication) {
        let footer = node(app, "classification-stage-footer")
        XCTAssertTrue(footer.exists && app.frame.contains(footer.frame))
        for id in ["medical-appointment-previous-result", "medical-appointment-import", "medical-appointment-next-result"] {
            let action = node(app, id)
            XCTAssertTrue(action.exists)
            XCTAssertGreaterThanOrEqual(action.frame.width, 44)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
            XCTAssertTrue(footer.frame.insetBy(dx: -1, dy: -1).contains(action.frame))
            if action.isEnabled {
                XCTAssertTrue(action.isHittable)
            }
        }
    }

    @MainActor
    private func waitForText(_ element: XCUIElement, expected: String) {
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            UITestConditions.text(element) == expected
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed)
    }
}
