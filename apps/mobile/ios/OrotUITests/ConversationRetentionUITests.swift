import CoreFoundation
import XCTest

/// The sender is synthetic; navigation, protected storage and app lifecycle are real.
@MainActor
final class ConversationRetentionUITests: OrotFailFastTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-retention", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    private func observe(_ app: XCUIApplication, _ expected: String) {
        app.buttons["retention-probe-refresh"].tap()
        let label = app.staticTexts["retention-probe-status"]
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", expected), object: label)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed, label.debugDescription)
    }

    private func send(_ app: XCUIApplication, question: String = "Synthetic retention question", waitForPartial: Bool = true) -> Bool {
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertTrue(UITestConditions.exists(input) && input.isHittable)
        input.tap()
        input.typeText(question)
        XCTAssertEqual(input.value as? String, question)
        app.buttons["rag-conversation-send"].tap()
        if waitForPartial {
            let partial = app.staticTexts["Synthetic partial response"]
            let error = UITestConditions.element(app, "rag-conversation-error")
            // A terminal error prevents a preview from appearing for this request.
            let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in partial.exists || error.exists || app.state == .notRunning }, object: nil)
            XCTAssertEqual(UITestConditions.wait(for: [outcome]), .completed)
            guard app.state != .notRunning else {
                XCTFail("Application terminated before the synthetic preview")
                return false
            }
            guard !error.exists else {
                let status = app.staticTexts["retention-probe-status"]
                XCTFail("Synthetic request failed before preview; \(status.exists ? status.label : "stage unavailable")")
                return false
            }
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        }
        return true
    }

    /// The keyboard can move the real conversation header above its scroll viewport.
    private func conversationAction(_ app: XCUIApplication, id: String, label: String) {
        let target = UITestConditions.element(app, id)
        if target.exists {
            XCTAssertNotNil(FormUITestConditions.reveal(target, in: app, scrollID: "rag-conversation-history", towardTop: true))
        }
        let action = NavigationPageActionUITestConditions.pageAction(app, id: id, label: label)
        XCTAssertTrue(action.exists && action.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(action.frame.width, 44)
        XCTAssertGreaterThanOrEqual(action.frame.height, 44)
        action.tap()
    }

    /// Background and restart use real iOS lifecycle transitions, without a real model.
    func testStreamSurvivesNavigationBackgroundAndRestoresAfterRestart() {
        let app = launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        guard send(app) else { return }
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:0")
        app.buttons["retention-probe-tab"].tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "retention-probe-other-tab")))
        app.buttons["retention-probe-tab"].tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        conversationAction(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "conversation-history-screen")))
        app.buttons["navigation-back"].tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:0")
        app.terminate()
        app.launch()
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:1")
        conversationAction(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        let row = UITestConditions.element(app, "conversation-history-session-2")
        XCTAssertTrue(UITestConditions.exists(row))
        row.tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic partial response"]))
        XCTAssertTrue(app.staticTexts["Synthetic retention question"].exists)
        XCTAssertFalse(app.buttons["rag-conversation-cancel"].exists)
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:1")
    }

    /// Completing while another session is visible must commit exactly one identity.
    func testCompletionCommitsOnceWhileAnotherConversationIsVisible() {
        let app = launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        guard send(app) else { return }
        observe(app, "dispatches:1 completions:0 previews:1 interrupted:0")
        conversationAction(app, id: "rag-conversation-new-session", label: "새 대화")
        app.buttons["retention-probe-release"].tap()
        observe(app, "dispatches:1 completions:1 previews:0 interrupted:0")
        XCTAssertFalse(app.staticTexts["Synthetic committed response"].exists)
        conversationAction(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        let original = UITestConditions.element(app, "conversation-history-session-1")
        XCTAssertTrue(UITestConditions.exists(original))
        original.tap()
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic committed response"]))
        observe(app, "dispatches:1 completions:1 previews:0 interrupted:0")
    }

    /// The retained request ID must lose its own native lease after each terminal outcome.
    private func verifyLeaseRelease(_ question: String, stop: Bool, completionCount: Int) {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-lease-release", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        guard send(app, question: question) else { return }
        observe(app, "lease:active")
        if stop {
            let action = app.buttons["rag-conversation-cancel"]
            guard action.exists else {
                XCTFail("Stop action is missing")
                return
            }
            let keyboard = app.keyboards.firstMatch
            let actionFrame = action.frame
            let hittable = action.isHittable
            let appFrame = app.frame
            let keyboardFrame = keyboard.exists ? keyboard.frame : .null
            func observedFrame(_ element: XCUIElement) -> String {
                element.exists ? String(describing: element.frame) : "unavailable"
            }
            XCTContext.runActivity(named: "Stop target: app=\(appFrame), action=\(actionFrame), keyboard=\(keyboardFrame), windows=\(app.windows.count), hittable=\(hittable), navigation=\(observedFrame(UITestConditions.element(app, "navigation-keyboard-avoiding-root"))), screen=\(observedFrame(UITestConditions.element(app, "rag-conversation-screen"))), composer=\(observedFrame(UITestConditions.element(app, "rag-conversation-composer"))), probe=\(observedFrame(app.staticTexts["retention-probe-status"]))") { _ in }
            // Reject a measured unreachable target before attempting to tap it.
            guard hittable, actionFrame.width >= 44, actionFrame.height >= 44,
                  appFrame.contains(actionFrame), !actionFrame.intersects(keyboardFrame)
            else {
                XCTFail("Stop action is not reachable in the measured viewport")
                return
            }
            action.tap()
        } else {
            app.buttons["retention-probe-release"].tap()
        }
        let cancel = app.buttons["rag-conversation-cancel"]
        let terminal = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !cancel.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [terminal]), .completed)
        if completionCount == 1 {
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic committed response"]))
        } else if stop {
            XCTAssertTrue(UITestConditions.exists(app.staticTexts["답변 생성을 중지했어요."]))
        } else {
            let error = UITestConditions.element(app, "rag-conversation-error")
            XCTAssertTrue(UITestConditions.exists(error))
            XCTAssertEqual(UITestConditions.text(error), "선택한 AI 서비스가 이 요청에 답하지 않았어요. 질문을 바꿔 다시 시도해 주세요.")
        }
        app.buttons["retention-probe-await-release"].tap()
        let statusElement = app.staticTexts["retention-probe-status"]
        let leaseResult = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.state == .notRunning || statusElement.label.contains("lease:released") || statusElement.label.contains("lease-observation-failed")
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [leaseResult]), .completed)
        guard app.state != .notRunning else {
            XCTFail("Application terminated before lease release")
            return
        }
        let status = statusElement.label
        XCTAssertTrue(status.contains("lease:released"), status)
        XCTAssertTrue(status.contains("dispatches:1 completions:\(completionCount)"), status)
        if stop {
            XCTAssertTrue(status.contains("interrupted:1"), status)
        }
    }

    func testNativeLeaseEndsAfterCommittedCompletion() {
        verifyLeaseRelease("Synthetic success question", stop: false, completionCount: 1)
    }

    func testNativeLeaseEndsAfterProviderFailure() {
        verifyLeaseRelease("Synthetic failure question", stop: false, completionCount: 0)
    }

    func testNativeLeaseEndsAfterExplicitStop() {
        verifyLeaseRelease("Synthetic stop question", stop: true, completionCount: 0)
    }

    /// A test-only wakeup arrives only after the protected commit and UIKit lease check.
    func testCompletionCommitsWhileBackgroundLeaseIsActive() {
        let token = UUID().uuidString
        let success = "com.orot.tests.conversation-background.\(token)" as CFString
        let failure = "com.orot.tests.conversation-background-failure.\(token)" as CFString
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let signal = BackgroundCommitSignal()
        let observer = Unmanaged.passRetained(signal).toOpaque()
        CFNotificationCenterAddObserver(center, observer, { _, pointer, _, _, _ in
            guard let pointer else { return }
            Unmanaged<BackgroundCommitSignal>.fromOpaque(pointer).takeUnretainedValue().receive(true)
        }, success, nil, .deliverImmediately)
        CFNotificationCenterAddObserver(center, observer, { _, pointer, _, _, _ in
            guard let pointer else { return }
            Unmanaged<BackgroundCommitSignal>.fromOpaque(pointer).takeUnretainedValue().receive(false)
        }, failure, nil, .deliverImmediately)
        defer {
            CFNotificationCenterRemoveObserver(center, observer, CFNotificationName(success), nil)
            CFNotificationCenterRemoveObserver(center, observer, CFNotificationName(failure), nil)
            Unmanaged<BackgroundCommitSignal>.fromOpaque(observer).release()
        }
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-background-retention", "-OROT_TEST_BACKGROUND_TOKEN", token]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        guard send(app, question: "Synthetic background question", waitForPartial: false) else { return }
        let status = app.staticTexts["retention-probe-status"]
        let errorElement = UITestConditions.element(app, "rag-conversation-error")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            signal.received || app.state == .notRunning || errorElement.exists || status.label.contains("ready:1") || status.label.contains("background-preflight-or-send-failed")
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        guard !signal.received, app.state != .notRunning, !errorElement.exists, status.label.contains("ready:1"), app.staticTexts["Synthetic partial response"].exists else {
            XCTFail("Background bridge or lease preflight failed")
            return
        }
        guard status.label.contains("dispatches:1 completions:0 previews:1 interrupted:0 background:0") else {
            XCTFail("The protected request or initial preview was unavailable before backgrounding")
            return
        }
        XCUIDevice.shared.press(.home)
        let terminal = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            signal.received || app.state == .notRunning
        }, object: nil)
        let outcome = UITestConditions.wait(for: [terminal])
        guard app.state != .notRunning else {
            XCTFail("Application terminated before background completion")
            return
        }
        app.activate()
        XCTAssertEqual(outcome, .completed, "Background completion observation was cancelled")
        XCTAssertTrue(signal.succeeded, "Background lease expired or the protected commit failed")
        observe(app, "dispatches:1 completions:1 previews:0 interrupted:0 background:1")
        XCTAssertTrue(UITestConditions.exists(app.staticTexts["Synthetic committed response"]))
        observe(app, "dispatches:1 completions:1 previews:0 interrupted:0 background:1")
    }
}
