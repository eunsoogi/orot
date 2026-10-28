import XCTest

/// Verifies Korean symptom copy and recovery through the production route with isolated test storage.
final class SymptomJournalRecoveryUITests: OrotFailFastTestCase {
    @MainActor
    func testSaveFailureKeepsKoreanErrorAndRetryRecovers() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        try launchJournal(app)

        let add = UITestConditions.element(app, "symptom-add")
        XCTAssertTrue(add.exists && add.isHittable)
        add.tap()
        let description = app.textViews["symptom-description"]
        XCTAssertTrue(description.exists)
        XCTAssertEqual(description.label, "증상 내용")
        XCTAssertTrue(FormUITestConditions.replace(
            description,
            with: "Synthetic symptom save retry",
            in: app,
            scrollID: "symptoms-scroll",
        ))
        XCTAssertTrue(FormUITestConditions.replace(
            app.textFields["symptom-onset-date"],
            with: "2026-10-28",
            in: app,
            scrollID: "symptoms-scroll",
        ))
        XCTAssertTrue(FormUITestConditions.replace(
            app.textFields["symptom-onset-time"],
            with: "09:30",
            in: app,
            scrollID: "symptoms-scroll",
        ))
        let active = UITestConditions.element(app, "symptom-status-active")
        FormUITestConditions.reveal(active, in: app, scrollID: "symptoms-scroll")
        XCTAssertEqual(active.label, "계속되고 있어요")
        XCTAssertTrue(active.isHittable)
        active.tap()

        let keyboardSave = UITestConditions.element(app, "symptom-keyboard-save-onsetTime")
        XCTAssertTrue(keyboardSave.exists && keyboardSave.isHittable)
        keyboardSave.tap()
        let error = UITestConditions.element(app, "symptom-form-error")
        XCTAssertTrue(error.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(error.label, "증상 기록을 저장하지 못했어요. 다시 시도해 주세요.")
        XCTAssertEqual(description.value as? String, "Synthetic symptom save retry")

        let retry = UITestConditions.element(app, "symptom-save")
        FormUITestConditions.reveal(retry, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(retry.exists && retry.isHittable)
        retry.tap()
        let saved = app.staticTexts["Synthetic symptom save retry"]
        XCTAssertTrue(saved.waitForAppearance(), app.debugDescription)
        XCTAssertFalse(error.exists)
        XCTAssertEqual(
            UITestConditions.element(app, "symptom-save-recovery-2-status").label,
            "계속되고 있어요",
        )
    }

    @MainActor
    func testCancelingNewSymptomKeepsJournalEmpty() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        try launchJournal(app)

        let add = UITestConditions.element(app, "symptom-add")
        XCTAssertTrue(add.exists && add.isHittable)
        add.tap()
        let description = app.textViews["symptom-description"]
        XCTAssertTrue(FormUITestConditions.replace(
            description,
            with: "Synthetic canceled symptom",
            in: app,
            scrollID: "symptoms-scroll",
        ))
        let cancel = UITestConditions.element(app, "symptom-form-cancel")
        FormUITestConditions.reveal(cancel, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()

        let empty = UITestConditions.element(app, "symptoms-empty")
        XCTAssertTrue(empty.waitForAppearance())
        XCTAssertEqual(empty.label, "이 조건에 맞는 증상 기록이 없어요.")
        XCTAssertFalse(app.staticTexts["Synthetic canceled symptom"].exists)
        XCTAssertTrue(add.exists)
        XCTAssertEqual(add.label, "증상 기록 추가")
        XCTAssertEqual(UITestConditions.element(app, "symptom-filter-active").label, "계속되고 있어요")
        XCTAssertEqual(UITestConditions.element(app, "symptom-filter-resolved").label, "나아졌어요")
    }

    @MainActor
    func testKoreanDeviceLanguageKeepsJournalCopyAndAccessibilityNames() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        try launchJournal(app, language: "ko")

        XCTAssertEqual(UITestConditions.element(app, "symptoms-title").label, "증상 일지")
        XCTAssertEqual(
            UITestConditions.element(app, "symptoms-empty").label,
            "이 조건에 맞는 증상 기록이 없어요.",
        )
        XCTAssertEqual(UITestConditions.element(app, "symptom-add").label, "증상 기록 추가")
        XCTAssertEqual(UITestConditions.element(app, "symptom-filter-active").label, "계속되고 있어요")
        XCTAssertEqual(UITestConditions.element(app, "symptom-filter-resolved").label, "나아졌어요")
    }

    /// Uses test-only storage and the app route under English or Korean device-language settings.
    @MainActor
    private func launchJournal(_ app: XCUIApplication, language: String = "en") throws {
        let locale = language == "ko" ? "ko_KR" : "en_US"
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "symptom-journal-save-recovery",
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", locale,
        ]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let open = UITestConditions.element(app, "symptoms-open")
        XCTAssertTrue(UITestConditions.exists(open))
        FormUITestConditions.reveal(open, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(open.isHittable)
        open.tap()
        NavigationUITestConditions.route(app, markers: ["symptoms-title"])
        XCTAssertEqual(UITestConditions.element(app, "symptoms-title").label, "증상 일지")
    }
}
