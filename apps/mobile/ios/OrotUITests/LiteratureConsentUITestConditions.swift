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

/// Synthetic-only point observations do not retry taps, wait for dispatch, or change success acceptance.
/// The immediate after sample can precede React updates; it is not a dispatch-failure verdict.
@MainActor
enum LiteratureSearchObservation {
    static func capture(_ app: XCUIApplication, phase: String, testCase: XCTestCase) {
        let matches = app.descendants(matching: .any).matching(identifier: "external-evidence-search")
        let action = matches.firstMatch
        let keyboard = app.keyboards.firstMatch
        let node = { (id: String) in UITestConditions.element(app, id) }
        let exists = action.exists
        let keyboardExists = keyboard.exists
        let actionFrame = exists ? action.frame : .zero
        let keyboardFrame = keyboardExists ? keyboard.frame : .zero
        // Never attach input contents, hierarchy, labels, URLs, or account/consent details.
        let queryMatches = node("external-evidence-query").value as? String == "sleep synthetic"
        let counter = node("synthetic-literature-search-count")
        let count = counter.exists ? Int(UITestConditions.text(counter)) : nil
        let fields = [
            "matches=\(matches.count), buttonMatches=\(app.buttons.matching(identifier: "external-evidence-search").count)",
            "exists=\(exists), enabled=\(exists && action.isEnabled), hittable=\(exists && action.isHittable)",
            "appFrame=\(app.frame), actionFrame=\(actionFrame), keyboardExists=\(keyboardExists), keyboardFrame=\(keyboardFrame)",
            "contained=\(exists && app.frame.contains(actionFrame)), keyboardOverlap=\(exists && keyboardExists && actionFrame.intersects(keyboardFrame))",
            "expectedQueryMatches=\(queryMatches), transportCount=\(count.map(String.init) ?? "unavailable")",
            "loading=\(node("external-evidence-loading").exists), results=\(node("external-evidence-result-list").exists)",
            "consentRequired=\(app.staticTexts["모델 설정에서 Europe PMC 검색어 전송에 동의한 뒤 검색해 주세요."].exists)",
            "unavailable=\(app.staticTexts["외부 자료를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."].exists)",
        ]
        let attachment = XCTAttachment(string: fields.joined(separator: "\n"))
        attachment.name = "synthetic-search-\(phase)"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
}
