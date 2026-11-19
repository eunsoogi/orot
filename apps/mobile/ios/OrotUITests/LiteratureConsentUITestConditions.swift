import XCTest

@MainActor
enum LiteratureConsentUITestConditions {
    /// Exercise the real settings decision; no test fixture writes a medical grant directly.
    static func approve(_ app: XCUIApplication) throws {
        let node = { (id: String) in UITestConditions.element(app, id) }
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["모델 설정에서 Europe PMC 검색어 전송에 동의한 뒤 검색해 주세요."]))
        XCTAssertEqual(node("external-evidence-query").value as? String, "sleep synthetic")
        XCTAssertEqual(UITestConditions.text(node("synthetic-literature-search-count")), "0")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        node("summary-visual-settings").tap()
        let option = node("provider-option-0")
        XCTAssertTrue(UITestConditions.exists(option))
        option.tap()
        let cancel = node("provider-selection-cancel")
        XCTAssertTrue(UITestConditions.exists(cancel))
        cancel.tap()
        XCTAssertFalse(node("provider-selection-confirmation").exists)
        option.tap()
        let medical = node("settings-consent-medical")
        guard FormUITestConditions.reveal(medical, in: app, scrollID: "settings-provider-screen") != nil else { return }
        XCTAssertEqual(medical.value as? String, "0")
        medical.tap()
        XCTAssertEqual(medical.value as? String, "1")
        NavigationPageActionUITestConditions.tap(app, id: "provider-selection-confirm", label: "이 AI 사용")
        XCTAssertTrue(UITestConditions.exists(node("summary-visual-picker")))
        node("summary-visual-literature").tap()
        XCTAssertTrue(UITestConditions.exists(node("external-medical-evidence-screen")))
        XCTAssertEqual(UITestConditions.text(node("synthetic-literature-search-count")), "0")
    }
}
