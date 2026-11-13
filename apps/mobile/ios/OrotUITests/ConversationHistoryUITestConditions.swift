import XCTest

/// Exercises the production session store and UIKit trailing gesture with a local synthetic sender.
@MainActor
enum ConversationHistoryUITestConditions {
    private static let question = "합성 기록의 복약 활동 수면과 건강 측정 변화를 함께 살펴보는 긴 제목입니다"

    static func verifyLongTitlesAndFullSwipe(testCase: XCTestCase) throws {
        var defaultHeight: CGFloat = 0
        for largeText in [false, true] {
            let app = XCUIApplication()
            app.launchArguments = [
                "-OROT_TEST_SCENARIO", "conversation-visual",
                "-UIPreferredContentSizeCategoryName", largeText ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL",
                "-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
                "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            ] + AppearanceUITestConditions.observationArguments
            app.launch()
            var original: AppearanceUITestConditions.Snapshot?
            defer {
                if let original {
                    do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: testCase) }
                    catch { XCTFail("Could not restore Simulator appearance: \(error)") }
                }
                app.terminate()
            }
            XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
            for dark in [false, true] {
                _ = try AppearanceUITestConditions.select(dark, returningTo: app, testCase: testCase, captureOriginal: {
                    if original == nil {
                        original = $0
                    }
                })
                let suffix = "\(largeText ? "maximum-text" : "default-text")-\(dark ? "dark" : "light")"
                NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-new-session", label: "새 대화")
                let input = node(app, "rag-conversation-input")
                ConversationComposerDockUITestConditions.assertReachable(input, in: app)
                input.tap()
                input.typeText(question)
                app.buttons.matching(identifier: "rag-conversation-send").firstMatch.tap()
                NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
                XCTAssertTrue(UITestConditions.exists(node(app, "conversation-history-screen")))
                _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
                // UIKit exposes the title as a child StaticText, not the container cell's label.
                let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation-history-session-")).firstMatch
                XCTAssertTrue(UITestConditions.exists(row))
                XCTAssertTrue(row.staticTexts[String(question.prefix(36))].firstMatch.exists, row.debugDescription)
                let rowID = row.identifier
                let page = node(app, "conversation-history-page")
                reveal(row, in: page)
                XCTAssertTrue(row.isHittable)
                XCTAssertTrue(page.frame.contains(row.frame), "Row \(row.frame), page \(page.frame)")
                XCTAssertGreaterThanOrEqual(node(app, "conversation-history-new").frame.height, 44)
                if largeText {
                    XCTAssertGreaterThan(row.frame.height, defaultHeight + 20)
                } else {
                    defaultHeight = row.frame.height
                }
                RecordingFixtureUITestConditions.capture(app, "history-long-title-\(suffix)", testCase: testCase)
                // Commit via the physical right-to-left gesture itself, without tapping Delete.
                row.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5))
                    .press(forDuration: 0.05, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5)))
                let undo = node(app, "conversation-history-undo")
                XCTAssertTrue(UITestConditions.exists(undo))
                XCTAssertFalse(node(app, rowID).exists)
                reveal(undo, in: page)
                XCTAssertTrue(undo.isHittable)
                XCTAssertGreaterThanOrEqual(undo.frame.width, 44)
                XCTAssertGreaterThanOrEqual(undo.frame.height, 44)
                try assertOwnedWindowContains(undo, in: app, testCase: testCase)
                RecordingFixtureUITestConditions.capture(app, "history-full-swipe-deleted-\(suffix)", testCase: testCase)
                undo.tap()
                let restored = node(app, rowID)
                XCTAssertTrue(UITestConditions.exists(restored))
                XCTAssertTrue(restored.staticTexts[String(question.prefix(36))].firstMatch.exists, restored.debugDescription)
                restored.tap()
                XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))
                XCTAssertTrue(UITestConditions.exists(app.staticTexts[question].firstMatch))
            }
        }
    }

    /// Checks that a Duo preview follows selection without exposing source actions; narrow phones keep the original return flow.
    static func verifySelectedConversationPreview() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "conversation-visual",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        defer { app.terminate() }

        let firstQuestion = "첫 번째 합성 기록 질문"
        let secondQuestion = "두 번째 합성 기록 질문"
        XCTAssertTrue(UITestConditions.exists(node(app, "rag-conversation-screen")))

        func send(_ question: String) {
            let input = node(app, "rag-conversation-input")
            ConversationComposerDockUITestConditions.assertReachable(input, in: app)
            input.tap()
            input.typeText(question)
            app.buttons.matching(identifier: "rag-conversation-send").firstMatch.tap()
        }

        send(firstQuestion)
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-new-session", label: "새 대화")
        send(secondQuestion)
        NavigationPageActionUITestConditions.tap(app, id: "rag-conversation-sessions-toggle", label: "대화 목록")
        XCTAssertTrue(UITestConditions.exists(node(app, "conversation-history-screen")))

        let rows = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "conversation-history-session-"),
        )
        XCTAssertEqual(rows.count, 2)
        let firstConversation = rows.element(boundBy: 1)
        let page = node(app, "conversation-history-page")
        reveal(firstConversation, in: page)
        XCTAssertTrue(firstConversation.isHittable)
        let preview = node(app, "conversation-history-preview")
        firstConversation.tap()

        let history = node(app, "conversation-history-screen")
        let conversation = node(app, "rag-conversation-screen")
        // Selection terminates either in a wide preview or in the compact conversation route.
        let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (history.exists && preview.exists) || (!history.exists && conversation.exists)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [selection]), .completed)
        if history.exists, preview.exists {
            reveal(preview, in: page)
            XCTAssertTrue(UITestConditions.exists(preview.staticTexts.matching(
                NSPredicate(format: "label CONTAINS %@", firstQuestion),
            ).firstMatch))
            XCTAssertEqual(
                preview.buttons.matching(
                    NSPredicate(format: "label BEGINSWITH %@", "원문 근거 열기"),
                ).count,
                0,
            )
            XCTAssertTrue(UITestConditions.exists(node(app, "conversation-history-screen")))
        } else {
            // Compact layouts have no preview and return to the selected conversation.
            XCTAssertTrue(UITestConditions.exists(conversation))
            XCTAssertTrue(app.staticTexts[firstQuestion].exists)
        }
    }

    private static func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    /// Bind the screen-space AX target to its owner after matching the independent UIKit window bounds.
    private static func assertOwnedWindowContains(_ target: XCUIElement, in app: XCUIApplication, testCase: XCTestCase) throws {
        let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "history-undo-native-window")
        let geometry = try XCTUnwrap(snapshot?["windowGeometry"] as? [String: Any])
        let bounds = try XCTUnwrap(geometry["windowBounds"] as? [String: Double])
        let width = try CGFloat(XCTUnwrap(bounds["width"]))
        let height = try CGFloat(XCTUnwrap(bounds["height"]))
        let windows = app.windows.allElementsBoundByIndex.filter {
            $0.exists && $0.descendants(matching: .any).matching(identifier: target.identifier).count > 0
        }
        XCTAssertEqual(windows.count, 1, "The undo control must belong to one AX window")
        let window = try XCTUnwrap(windows.first)
        // UIKit reports window-local bounds; XCTest reports screen-space frames, so correlate the owner by size before containment.
        XCTAssertEqual(window.frame.width, width, accuracy: 0.5)
        XCTAssertEqual(window.frame.height, height, accuracy: 0.5)
        XCTAssertTrue(window.frame.contains(target.frame), "Undo \(target.frame), owning AX window \(window.frame)")
    }

    /// At maximum text size the section header can push a valid row below the viewport.
    /// Clear UIKit's pan threshold; pause before lifting to avoid inertial overshoot past the row.
    private static func reveal(_ row: XCUIElement, in list: XCUIElement) {
        for _ in 0 ..< 4 {
            let viewport = list.frame
            let frame = row.frame
            print("HISTORY_ROW_GEOMETRY row=\(frame) list=\(viewport)")
            if viewport.contains(frame) || frame.height > viewport.height {
                return
            }
            let overflow = frame.maxY > viewport.maxY ? frame.maxY - viewport.maxY + 1 : frame.minY - viewport.minY - 1
            let distance = max(40, min(80, abs(overflow)))
            let shift = (overflow > 0 ? distance : -distance) / viewport.height
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5 - shift)),
                       withVelocity: XCUIGestureVelocity(rawValue: 80), thenHoldForDuration: 0.5)
        }
    }
}
