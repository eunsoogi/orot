import XCTest

/// Exercises synthetic loopback authentication and native Keychain state; this never proves a real ChatGPT account or provider result.
final class ProviderSelectionUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit() throws {
        let app = launch()
        defer { app.terminate() }
        reset(app)
        tap(app, "provider-selection-native-auth-cancel")
        try continueLocalConsent(app)
        summary(app, "nativeAuthSessionCancellation=verified; realAccount=unverified")
        reset(app)
        tap(app, "provider-selection-auth-cancel")
        tap(app, "chatgpt-account-action")
        XCTAssertTrue(UITestConditions.exists(node(app, "chatgpt-cancel-sign-in"), timeout: 120))
        back(app)
        cleared(app)
        tap(app, "provider-selection-auth-cancel")
        tap(app, "chatgpt-account-action")
        tap(app, "chatgpt-cancel-sign-in")
        try message(app, "ChatGPT 로그인을 취소했어요.")
        back(app)
        cleared(app)
        tap(app, "provider-selection-auth-success")
        tap(app, "chatgpt-account-action")
        try continueLocalConsent(app)
        try message(app, "로그인을 확인했어요. 모델 목록을 확인하려면 다시 눌러 주세요.")
        try message(app, "선택한 계정의 모델 목록 불러오기")
        back(app)
        cleared(app)
        reset(app)
        capture(app, "synthetic-auth-return-without-implicit-selection")
    }

    @MainActor
    func testExplicitSelectionAndKeychainRestoreNeverChooseAnAutomaticFallback() throws {
        let app = launch()
        defer { app.terminate() }
        reset(app)
        app.terminate()
        app.launch()
        try message(app, "아직 AI를 선택하지 않았어요. 사용할 AI를 직접 골라 주세요.")
        XCTAssertTrue(UITestConditions.text(node(app, "provider-selection-probe-summary")).contains("selectionCallback=not-called-on-load"))
        // Fixture controls and the real safe area can shorten the catalog viewport; scroll the actual model row into view before selecting it.
        FormUITestConditions.reveal(node(app, "provider-option-1"), in: app, scrollID: "provider-selection-screen")
        tap(app, "provider-option-1")
        XCTAssertTrue(UITestConditions.exists(node(app, "provider-option-12"), timeout: 120))
        DebugUITestConditions.dismissWarningToast(app)
        let confirm = node(app, "provider-selection-confirm")
        FormUITestConditions.reveal(confirm, in: app, scroll: footerScroll(app))
        XCTAssertTrue(node(app, "provider-selection-confirmation-privacy").isHittable)
        XCTAssertTrue(confirm.isHittable)
        confirm.tap()
        summary(app, "selectionCallback=called; synthetic=provider-selection; realAccount=unverified")
        app.terminate()
        app.launch()
        try message(app, "현재 선택: Synthetic ChatGPT model")
        XCTAssertTrue(UITestConditions.text(node(app, "provider-selection-probe-summary")).contains("selectionCallback=not-called-on-load"))
        reset(app)
        capture(app, "synthetic-explicit-selection-restored-from-keychain")
    }

    @MainActor
    func testSignOutCancelsTheOpenResponseAndSurvivesProcessRestartBeforeRelogin() async throws {
        let app = launch()
        defer { app.terminate() }
        reset(app)
        tap(app, "provider-selection-sign-out-start")
        // The real catalog keeps sign-out inside expanded account management; open it before starting the original lifecycle assertions.
        FormUITestConditions.reveal(node(app, "chatgpt-account-details"), in: app, scrollID: "provider-selection-screen")
        tap(app, "chatgpt-account-details")
        XCTAssertTrue(UITestConditions.exists(node(app, "chatgpt-account-sign-out"), timeout: 120))
        try message(app, "ChatGPT 계정 1 로그아웃")
        tap(app, "provider-selection-sign-out-request")
        value(app, "provider-selection-sign-out-response", "pending-after-delta")
        tap(app, "chatgpt-account-sign-out")
        value(app, "provider-selection-sign-out-response", "failed:authentication_required")
        try message(app, "ChatGPT 계정 1의 앱 저장 인증 정보를 삭제했고 갱신 토큰 폐기를 확인했어요. 브라우저 세션 상태는 확인되지 않아요.")
        let unavailable = "이전에 선택한 AI를 사용할 수 없어요. 자동으로 다른 AI를 고르지 않았습니다."
        try message(app, unavailable)
        // Preserve the original stable observation window after the open response is cancelled.
        try await Task.sleep(for: .milliseconds(500))
        value(app, "provider-selection-sign-out-response", "failed:authentication_required")
        back(app)
        app.terminate()
        app.launch()
        summary(app, "selectionCallback=not-called-on-load; synthetic=enabled; realAccount=unverified")
        tap(app, "provider-selection-sign-out-reopen")
        FormUITestConditions.reveal(node(app, "chatgpt-account-details"), in: app, scrollID: "provider-selection-screen")
        tap(app, "chatgpt-account-details")
        XCTAssertTrue(UITestConditions.exists(node(app, "chatgpt-account-status"), timeout: 120))
        try message(app, unavailable)
        tap(app, "chatgpt-account-action")
        try message(app, "로그인을 확인했어요. 모델 목록을 확인하려면 다시 눌러 주세요.")
        XCTAssertTrue(UITestConditions.exists(node(app, "chatgpt-account-sign-out"), timeout: 120))
        capture(app, "synthetic-sign-out-reopened-and-relogin-confirmed")
        back(app)
        reset(app)
    }

    @MainActor
    private func back(_ app: XCUIApplication) {
        // This standalone flow exposes its own Back action; the actual provider screen has no shared navigation toolbar.
        let action = app.buttons.matching(identifier: "provider-selection-back").firstMatch
        FormUITestConditions.reveal(action, in: app, scrollID: "provider-selection-screen", towardTop: true)
        XCTAssertTrue(UITestConditions.exists(action) && action.isHittable, app.debugDescription)
        XCTAssertEqual(action.label, "이전 화면으로 돌아가기")
        XCTAssertGreaterThanOrEqual(action.frame.width, 44)
        XCTAssertGreaterThanOrEqual(action.frame.height, 44)
        action.tap()
    }

    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "provider-selection", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(UITestConditions.exists(node(app, "provider-selection-probe-reset"), timeout: 240))
        DebugUITestConditions.dismissWarningToast(app)
        return app
    }

    @MainActor
    private func continueLocalConsent(_ app: XCUIApplication) throws {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let presented = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.alerts.firstMatch.exists || springboard.alerts.firstMatch.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [presented], timeout: 120), .completed)
        let alert = app.alerts.firstMatch.exists ? app.alerts.firstMatch : springboard.alerts.firstMatch
        let text = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
        XCTAssertTrue(text.contains("127.0.0.1") || text.contains("localhost"), text)
        let consent = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Continue", "계속"])).firstMatch
        XCTAssertTrue(consent.exists && consent.isHittable, alert.debugDescription)
        consent.tap()
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        // The native auth callback can arrive while its system sheet is still dismissing. Wait for the actual first touch to be possible, without repeating it.
        let ready = NSPredicate { _, _ in target.exists && target.isHittable && !target.frame.isEmpty && app.frame.contains(target.frame) }
        if !ready.evaluate(with: nil) {
            let condition = XCTNSPredicateExpectation(predicate: ready, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [condition], timeout: 120), .completed, app.debugDescription)
        }
        target.tap()
    }

    @MainActor
    private func value(_ app: XCUIApplication, _ id: String, _ text: String) {
        UITestConditions.value(node(app, id), equals: text, timeout: 120)
    }

    @MainActor
    private func summary(_ app: XCUIApplication, _ text: String) {
        value(app, "provider-selection-probe-summary", text)
    }

    @MainActor
    private func cleared(_ app: XCUIApplication) {
        summary(app, "selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified")
    }

    @MainActor
    private func reset(_ app: XCUIApplication) {
        tap(app, "provider-selection-probe-reset")
        cleared(app)
    }

    @MainActor
    private func footerScroll(_ app: XCUIApplication) -> XCUIElement {
        let footer = node(app, "provider-selection-footer")
        XCTAssertTrue(UITestConditions.exists(footer) && !footer.frame.isEmpty)
        // React Native may flatten the footer subtree in AX. Its real viewport remains geometrically contained by the tagged footer.
        let scroll = app.scrollViews.allElementsBoundByIndex.filter {
            !$0.frame.isEmpty && footer.frame.contains($0.frame)
        }.max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
            ?? footer.scrollViews.firstMatch
        XCTAssertTrue(UITestConditions.exists(scroll) && !scroll.frame.isEmpty, app.debugDescription)
        return scroll
    }

    @MainActor
    private func message(_ app: XCUIApplication, _ text: String) throws {
        DebugUITestConditions.dismissWarningToast(app)
        // React Native groups action titles into their native Button. Match the exact accessible label before checking visibility for its actual role.
        let target = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch
        XCTAssertTrue(UITestConditions.exists(target, timeout: 120), app.debugDescription)
        let footer = node(app, "provider-selection-footer")
        let inFooter = footer.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch.exists
        // Native ScrollViews retain content ownership even when React Native flattens tagged containers. Offscreen main content can overlap the footer's frame, so ancestry takes priority over geometry.
        let scrolls = app.scrollViews.allElementsBoundByIndex
        let owner = scrolls.filter {
            $0.descendants(matching: .any).matching(NSPredicate(format: "label == %@", text)).firstMatch.exists
        }.min { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
        let containing = scrolls.filter {
            !target.frame.isEmpty && $0.frame.contains(target.frame)
        }.min { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
        let scroll = owner ?? containing ?? (inFooter ? footerScroll(app) : node(app, "provider-selection-screen"))
        // Preserve the original visible-message requirement with real scrolling and rendered pixels; static text need not provide a touch activation point.
        FormUITestConditions.reveal(target, in: app, scroll: scroll, requireHittable: false)
        if target.elementType == .button {
            // A button has a native activation point; its adjacent symbol is not part of the title's text oracle.
            XCTAssertTrue(target.isHittable && app.frame.contains(target.frame), app.debugDescription)
            XCTAssertEqual(UITestConditions.text(target), text)
            capture(app, "visible-exact-provider-action-title")
        } else {
            try RenderedTextUITestConditions.verify(target, equals: text, in: app, testCase: self)
        }
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
