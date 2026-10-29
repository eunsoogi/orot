import XCTest

/// Keeps the synthetic session boundary explicit while testing review actions and system appearance changes.
final class NextVisitReviewUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testCitedReviewSaveCancelAndReloadRetainTheSavedQuestionsAcrossAppearanceChanges() throws {
        try AppearanceUITestConditions.verifyObservationContract()
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "next-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + AppearanceUITestConditions.observationArguments
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
        // The native tools modal hides the application accessibility tree; close it before observing the actual screen theme.
        tap(app, "next-visit-probe-close-tools")
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { appearance = $0 })
        DebugUITestConditions.dismissWarningToast(app)
        let scroll = node(app, "next-visit-questions-scroll")
        XCTAssertTrue(UITestConditions.exists(scroll))
        // The test ID belongs to React's accessibility container. Compare the actual UIKit scroll viewport across keyboard dismissal.
        let viewport = scroll.scrollViews.firstMatch
        XCTAssertTrue(UITestConditions.exists(viewport))
        let initialViewport = viewport.frame
        try captureViewport(app, container: scroll, viewport: viewport, stage: "initial")
        XCTAssertTrue(app.staticTexts["합성 진료 예약"].exists)
        reveal(app, "next-visit-generate")
        tap(app, "next-visit-generate")
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
        reveal(app, "next-visit-review-save")
        tap(app, "next-visit-review-save")
        UITestConditions.value(node(app, "next-visit-save-message"), equals: "검토한 질문을 이 예약에 저장했어요.")
        try savedQuestion(app)
        reveal(app, "next-visit-saved-edit")
        top(app)
        capture(app, "saved-questions-light")
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertTrue(node(app, "next-visit-title").exists)
        capture(app, "saved-questions-dark")
        reveal(app, "next-visit-saved-edit")
        tap(app, "next-visit-saved-edit")
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
        try captureViewport(app, container: scroll, viewport: viewport, stage: "restored")
        XCTAssertEqual(viewport.frame.height, initialViewport.height, accuracy: 0.5)
        try NavigationUITestConditions.scrollToBottom(app, "next-visit-questions-scroll")
        capture(app, "saved-questions-bottom-clear")
        tap(app, "next-visit-probe-tools")
        tap(app, "next-visit-probe-reload-screen")
        try savedQuestion(app)
        // Check the preserved caveat once after rehydration; repeating this bottom trip after every text assertion adds no boundary.
        reveal(app, "next-visit-caveat-conflicting_records")
    }

    @MainActor
    func testSaveRemainsAboveTheActualKeyboardWhileEditingTheThirdQuestion() throws {
        try verifyKeyboardSavePosition(expectsRightRail: false)
    }

    @MainActor
    func testDuoRightRailKeepsKeyboardSaveInsideTheContentLane() throws {
        try verifyKeyboardSavePosition(expectsRightRail: true)
    }

    /// Duo keeps the heading and save action in content; the shared iPhone fixture checks keyboard reachability only.
    @MainActor
    private func verifyKeyboardSavePosition(expectsRightRail: Bool) throws {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(UITestConditions.exists(node(app, "welcome-title")))
        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        tap(app, "ai-feature-visit-questions")
        NavigationUITestConditions.route(app, markers: ["next-visit-questions-scroll"])
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        XCTAssertEqual(back.control.label, "이전 화면으로 돌아가기")
        if expectsRightRail {
            XCTAssertTrue(node(app, "next-visit-question-columns-primary").frame.contains(node(app, "next-visit-title").frame))
            XCTAssertEqual(back.toolbar.frame.width, 48, accuracy: 0.5)
            XCTAssertGreaterThan(back.toolbar.frame.midX, app.frame.midX)
        }
        XCTAssertFalse(node(app, "next-visit-questions-back").exists)
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-appointment-time")))
        XCTAssertEqual(node(app, "next-visit-provider-select").label, "AI 선택 또는 변경, 합성 UI 검사 제공자")
        reveal(app, "next-visit-generate")
        tap(app, "next-visit-generate")
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
        let save = node(app, "next-visit-review-save")
        FormUITestConditions.reveal(save, in: app, scrollID: "next-visit-questions-scroll", avoiding: input)
        if expectsRightRail {
            XCTAssertLessThan(save.frame.maxX, back.toolbar.frame.minX)
        }
        XCTAssertTrue(save.exists && save.isHittable)
        XCTAssertLessThanOrEqual(save.frame.maxY, keyboardTop)
        capture(app, "visit-questions-keyboard-save-action")
        save.tap()
        UITestConditions.value(node(app, "next-visit-save-message"), equals: "검토한 질문을 이 예약에 저장했어요.")
        capture(app, "visit-questions-after-save")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["ai-features-screen"])
    }


    @MainActor
    private func savedQuestion(_ app: XCUIApplication) throws {
        top(app)
        let saved = app.staticTexts.matching(NSPredicate(format: "label == %@", "검토해 수정한 합성 질문")).firstMatch
        FormUITestConditions.reveal(saved, in: app, scrollID: "next-visit-questions-scroll", requireHittable: false)
        XCTAssertTrue(node(app, "next-visit-saved-list").exists)
        try RenderedTextUITestConditions.verify(saved, equals: "검토해 수정한 합성 질문", in: app, testCase: self)
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

    @MainActor
    private func captureViewport(_ app: XCUIApplication, container: XCUIElement, viewport: XCUIElement, stage: String) throws {
        let report: [String: Any] = ["stage": stage, "container": String(describing: container.frame),
                                     "viewport": String(describing: viewport.frame), "application": String(describing: app.frame),
                                     "keyboardVisible": app.keyboards.firstMatch.exists]
        let data = try JSONSerialization.data(withJSONObject: report)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "review-viewport-\(stage)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
