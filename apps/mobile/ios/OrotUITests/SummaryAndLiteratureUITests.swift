import XCTest

final class SummaryAndLiteratureUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Synthetic results use real encrypted storage and source validation, including a new application process.
    @MainActor
    func testSavedSummaryRestoresAfterRelaunchAndHistoryReadRecoversAcrossAppearances() throws {
        let app = XCUIApplication()
        launch(app)
        var original: AppearanceUITestConditions.Snapshot?
        defer { restore(original, app: app) }
        for dark in [false, true] {
            try select(dark, app: app, original: &original)
            let suffix = dark ? "dark" : "light"
            node(app, "summary-visual-open").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "disease-hypotheses-screen")))
            node(app, "symptom-summary-history-open").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "summary-history-screen")))
            if !dark {
                XCTAssertTrue(UITestConditions.exists(app.staticTexts["저장된 요약이 없어요."]))
                capture(app, "summary-history-empty-\(suffix)")
            }
            try back(app)
            node(app, "symptom-summary-generate").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "symptom-summary-saved")))
            assertSummary(app)
            capture(app, "summary-saved-\(suffix)")
            // The first section is above the current scroll position after reading sleep.
            node(app, "disease-hypotheses-screen").swipeDown()
            let citation = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "원문 근거 열기")).firstMatch
            UITestConditions.scrollTo(citation, in: app)
            citation.tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "ai-feature-source-detail")))
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["70.5 kg"]))
            capture(app, "summary-restored-source-\(suffix)")
            try back(app)
            // No fixture reseeding or generation happens between termination and restoration.
            app.terminate()
            launch(app)
            // A fresh window has no previous test override. Reapply and observe the requested appearance after relaunch.
            try select(dark, app: app, original: &original)
            node(app, "summary-visual-open").tap()
            XCTAssertFalse(node(app, "disease-hypotheses-results").exists)
            node(app, "symptom-summary-history-open").tap()
            let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "합성 요약 모델")).firstMatch
            XCTAssertTrue(UITestConditions.exists(row))
            capture(app, "summary-history-persisted-\(suffix)")
            row.tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "symptom-summary-saved")))
            assertSummary(app)
            capture(app, "summary-restored-\(suffix)")
            try back(app)
            XCTAssertTrue(UITestConditions.exists(node(app, "summary-visual-picker")))
            node(app, "summary-visual-read-failure").tap()
            node(app, "symptom-summary-history-open").tap()
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["저장된 요약을 불러오지 못했어요."]))
            capture(app, "summary-history-read-error-\(suffix)")
            app.buttons["다시 불러오기"].tap()
            XCTAssertTrue(UITestConditions.exists(row))
            capture(app, "summary-history-recovered-\(suffix)")
            try back(app)
            try back(app)
        }
    }

    /// A focused keyboard must deliver the first Search tap; only a synthetic search service is called.
    @MainActor
    func testLiteratureConsentSearchRecoveryAndCancelledReadAcrossAppearances() throws {
        let app = XCUIApplication()
        launch(app)
        var original: AppearanceUITestConditions.Snapshot?
        defer { restore(original, app: app) }
        for dark in [false, true] {
            try select(dark, app: app, original: &original)
            let suffix = dark ? "dark" : "light"
            node(app, "summary-visual-literature").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "external-medical-evidence-screen")))
            query(app, "sleep synthetic")
            node(app, "external-evidence-search").tap()
            if !dark {
                // Assert after the real tap/idleness, rather than masking a consumed tap with a second one.
                XCTAssertTrue(node(app, "inference-disclosure-sheet").exists, app.debugDescription)
                capture(app, "literature-query-consent-\(suffix)")
                node(app, "inference-disclosure-cancel").tap()
                XCTAssertTrue(UITestConditions.exists(app.staticTexts["검색어 전송에 동의한 뒤 검색할 수 있어요."]))
                node(app, "external-evidence-search").tap()
                XCTAssertTrue(UITestConditions.exists(node(app, "inference-disclosure-sheet")))
                node(app, "inference-disclosure-allow").tap()
            }
            let title = app.staticTexts["합성 문헌: 활동과 수면 기록 해석"]
            XCTAssertTrue(UITestConditions.exists(title))
            capture(app, "literature-result-\(suffix)")
            let open = app.buttons["원문 열기"]
            UITestConditions.scrollTo(open, in: app)
            open.tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "synthetic-article-opened")))
            try back(app)
            for (value, marker) in [("empty", "external-evidence-empty"), ("failure", "")] {
                query(app, value)
                node(app, "external-evidence-search").tap()
                let message = marker.isEmpty ? app.staticTexts["외부 자료를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."] : node(app, marker)
                XCTAssertTrue(UITestConditions.exists(message))
                capture(app, "literature-\(value)-\(suffix)")
            }
            query(app, "recovered synthetic")
            node(app, "external-evidence-search").tap()
            XCTAssertTrue(UITestConditions.exists(title))
            capture(app, "literature-recovered-\(suffix)")
            query(app, "pending synthetic")
            node(app, "external-evidence-search").tap()
            XCTAssertTrue(UITestConditions.exists(node(app, "external-evidence-loading")))
            capture(app, "literature-loading-\(suffix)")
            try back(app)
            XCTAssertTrue(UITestConditions.exists(node(app, "summary-visual-picker")))
            node(app, "summary-visual-literature").tap()
            XCTAssertFalse(node(app, "external-evidence-loading").exists)
            XCTAssertFalse(title.exists)
            capture(app, "literature-cancelled-\(suffix)")
            try back(app)
        }
    }

    @MainActor
    private func assertSummary(_ app: XCUIApplication) {
        let scroll = node(app, "disease-hypotheses-screen")
        let viewport = scroll.scrollViews.firstMatch
        XCTAssertTrue(UITestConditions.exists(viewport))
        for text in ["합성 체중 기록은 70.5 kg이에요.", "합성 활동 기록에는 2,400걸음이 있어요.", "합성 코어 수면 구간은 90분이에요. 하루 전체 수면은 아니에요."] {
            let value = app.staticTexts[text].firstMatch
            XCTAssertTrue(UITestConditions.exists(value))
            // These are readable text spans, not touch controls. Inspect actual viewport bounds instead of isHittable.
            for _ in 0 ..< 8 {
                if viewport.frame.contains(value.frame) {
                    break
                }
                if value.frame.minY < viewport.frame.minY {
                    scroll.swipeDown()
                } else {
                    scroll.swipeUp()
                }
            }
            XCTAssertFalse(value.frame.isEmpty)
            XCTAssertTrue(viewport.frame.contains(value.frame), value.debugDescription)
        }
    }

    @MainActor
    private func query(_ app: XCUIApplication, _ text: String) {
        let input = node(app, "external-evidence-query")
        node(app, "external-medical-evidence-screen").swipeDown()
        UITestConditions.scrollTo(input, in: app)
        input.tap()
        let previous = (input.value as? String) ?? ""
        if previous != "예: 수면과 혈압의 관계", !previous.isEmpty {
            input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count))
        }
        input.typeText(text)
    }

    @MainActor
    private func launch(_ app: XCUIApplication) {
        app.launchArguments = ["-OROT_TEST_SCENARIO", "summary-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
        app.launch()
        XCTAssertTrue(UITestConditions.exists(node(app, "summary-visual-picker")))
    }

    @MainActor
    private func select(_ dark: Bool, app: XCUIApplication, original: inout AppearanceUITestConditions.Snapshot?) throws {
        var captured = original
        defer { original = captured }
        _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: self, captureOriginal: {
            if captured == nil {
                captured = $0
            }
        })
    }

    @MainActor
    private func restore(_ original: AppearanceUITestConditions.Snapshot?, app: XCUIApplication) {
        if let original {
            do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
            catch { XCTFail("Could not restore owned Simulator appearance: \(error)") }
        }
        app.terminate()
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func back(_ app: XCUIApplication) throws {
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        RecordingFixtureUITestConditions.capture(app, name, testCase: self)
    }
}
