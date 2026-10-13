import XCTest

/// Keeps the original synthetic session boundary explicit while testing the production review, native toolbar and system appearance changes.
final class NextVisitReviewUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testCitedReviewSaveCancelAndReloadRetainTheSavedQuestionsAcrossAppearanceChanges() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "next-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        var appearance: AppearanceUITestConditions.Snapshot?
        defer {
            if let appearance {
                do {
                    try AppearanceUITestConditions.restore(appearance, returningTo: app, testCase: self)
                } catch {
                    XCTFail("Could not restore the owned Simulator's appearance: \(error)")
                }
            }
            app.terminate()
        }
        let boundary = node(app, "next-visit-probe-boundary")
        XCTAssertTrue(UITestConditions.exists(boundary))
        XCTAssertEqual(UITestConditions.text(boundary), "합성 화면 흐름 · 실제 AI 제공자와 영구 저장소는 검증하지 않음")
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        tap(app, "next-visit-probe-close-tools")
        DebugUITestConditions.dismissWarningToast(app)
        let scroll = node(app, "next-visit-questions-scroll")
        XCTAssertTrue(UITestConditions.exists(scroll))
        let initialViewport = scroll.frame
        XCTAssertTrue(app.staticTexts["합성 진료 예약"].exists)
        try NavigationUITestConditions.tapNative(app, "next-visit-generate")
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-generation-loading")))
        tap(app, "next-visit-probe-tools")
        tap(app, "next-visit-probe-complete-generation")
        reveal(app, "next-visit-caveat-conflicting_records")
        top(app)
        capture(app, "edit-questions-light")
        reveal(app, "next-visit-source-0-0")
        tap(app, "next-visit-source-0-0")
        UITestConditions.value(node(app, "next-visit-source-content"), equals: "합성 기록에서 가져온 예시 문장입니다.")
        tap(app, "next-visit-source-close")
        top(app)
        replace(app, "검토해 수정한 합성 질문")
        try NavigationUITestConditions.tapNative(app, "next-visit-review-save")
        UITestConditions.value(node(app, "next-visit-save-message"), equals: "검토한 질문을 이 예약에 저장했어요.")
        try savedQuestion(app)
        _ = try NavigationUITestConditions.nativeAction(app, "next-visit-saved-edit")
        top(app)
        capture(app, "saved-questions-light")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(node(app, "next-visit-title").exists)
        capture(app, "saved-questions-dark")
        try NavigationUITestConditions.tapNative(app, "next-visit-saved-edit")
        top(app)
        capture(app, "edit-questions-dark")
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self)
        top(app)
        replace(app, "저장되지 않은 임시 수정")
        reveal(app, "next-visit-review-cancel")
        try NavigationUITestConditions.contentAboveBar(app, scrollID: "next-visit-questions-scroll", contentID: "next-visit-review-cancel")
        tap(app, "next-visit-review-cancel")
        try savedQuestion(app)
        XCTAssertFalse(app.staticTexts["저장되지 않은 임시 수정"].exists)
        XCTAssertEqual(scroll.frame.height, initialViewport.height, accuracy: 0.5)
        try NavigationUITestConditions.scrollToBottom(app, "next-visit-questions-scroll")
        capture(app, "saved-questions-bottom-clear")
        tap(app, "next-visit-probe-tools")
        tap(app, "next-visit-probe-reload-screen")
        try savedQuestion(app)
    }

    @MainActor
    func testNativeSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        tap(app, "ai-feature-visit-questions")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        let back = try NavigationUITestConditions.nativeAction(app, "navigation-back")
        XCTAssertEqual(back.control.label, "이전 화면으로 돌아가기")
        XCTAssertFalse(node(app, "next-visit-questions-back").exists)
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-appointment-time")))
        XCTAssertEqual(node(app, "next-visit-provider-select").label, "AI 선택 또는 변경, 합성 UI 검사 제공자")
        try NavigationUITestConditions.tapNative(app, "next-visit-generate")
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-review-save")))
        try NavigationUITestConditions.scrollToBottom(app, "next-visit-questions-scroll")
        let input = node(app, "next-visit-question-text-2")
        FormUITestConditions.reveal(input, in: app, scrollID: "next-visit-questions-scroll")
        input.tap()
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch))
        let marker = node(app, "ai-feature-visit-questions-keyboard-visible")
        XCTAssertTrue(UITestConditions.exists(marker))
        let parts = marker.label.split(separator: ":")
        XCTAssertEqual(parts.count, 3)
        guard parts.count == 3 else { return }
        XCTAssertEqual(parts[0], "keyboard-visible")
        let keyboardTop = try XCTUnwrap(Double(parts[1]))
        let keyboardHeight = try XCTUnwrap(Double(parts[2]))
        XCTAssertGreaterThan(keyboardHeight, 0)
        // UIKit's event includes the 44-point input assistant; XCUI's Keyboard element contains only the keys. Require the actual visible panel inside the complete event frame.
        let keyboard = app.keyboards.firstMatch.frame
        XCTAssertTrue(keyboard.intersects(app.frame))
        XCTAssertGreaterThan(keyboard.height, 0)
        XCTAssertGreaterThanOrEqual(keyboard.minY, keyboardTop)
        XCTAssertLessThanOrEqual(keyboard.maxY, keyboardTop + keyboardHeight + 1)
        let save = try NavigationUITestConditions.nativeAction(app, "next-visit-review-save")
        XCTAssertLessThanOrEqual(save.control.frame.maxY, keyboardTop)
        capture(app, "visit-questions-keyboard-save-action")
        try NavigationUITestConditions.tapNative(app, "next-visit-review-save")
        UITestConditions.value(node(app, "next-visit-save-message"), equals: "검토한 질문을 이 예약에 저장했어요.")
        capture(app, "visit-questions-after-save")
        try NavigationUITestConditions.tapNative(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
    }

    @MainActor
    private func savedQuestion(_ app: XCUIApplication) throws {
        top(app)
        let saved = app.staticTexts.matching(NSPredicate(format: "label == %@", "검토해 수정한 합성 질문")).firstMatch
        FormUITestConditions.reveal(saved, in: app, scrollID: "next-visit-questions-scroll", requireHittable: false)
        XCTAssertTrue(node(app, "next-visit-saved-list").exists)
        try RenderedTextUITestConditions.verify(saved, equals: "검토해 수정한 합성 질문", in: app, testCase: self)
        reveal(app, "next-visit-caveat-conflicting_records")
    }

    @MainActor
    private func replace(_ app: XCUIApplication, _ text: String) {
        FormUITestConditions.replace(node(app, "next-visit-question-text-0"), with: text, in: app, scrollID: "next-visit-questions-scroll")
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(UITestConditions.exists(target))
        XCTAssertTrue(target.isHittable, target.debugDescription)
        target.tap()
    }

    @MainActor
    private func reveal(_ app: XCUIApplication, _ id: String) {
        FormUITestConditions.reveal(node(app, id), in: app, scrollID: "next-visit-questions-scroll")
    }

    @MainActor
    private func top(_ app: XCUIApplication) {
        FormUITestConditions.reveal(node(app, "next-visit-title"), in: app, scrollID: "next-visit-questions-scroll", towardTop: true)
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
