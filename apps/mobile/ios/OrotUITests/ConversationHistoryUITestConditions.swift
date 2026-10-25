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
                node(app, "rag-conversation-new-session").tap()
                let input = node(app, "rag-conversation-input")
                input.tap()
                input.typeText(question)
                app.buttons.matching(identifier: "rag-conversation-send").firstMatch.tap()
                node(app, "rag-conversation-sessions-toggle").tap()
                XCTAssertTrue(UITestConditions.exists(node(app, "conversation-history-screen")))
                _ = try NavigationUITestConditions.navigationAction(app, "navigation-back")
                // UIKit exposes the title as a child StaticText, not the container cell's label.
                let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation-history-session-")).firstMatch
                XCTAssertTrue(UITestConditions.exists(row))
                XCTAssertTrue(row.staticTexts[String(question.prefix(36))].firstMatch.exists, row.debugDescription)
                let rowID = row.identifier
                let list = node(app, "conversation-history-list")
                reveal(row, in: list)
                XCTAssertTrue(row.isHittable)
                XCTAssertTrue(list.frame.contains(row.frame), "Row \(row.frame), list \(list.frame)")
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
                XCTAssertTrue(undo.isHittable)
                XCTAssertTrue(app.frame.contains(undo.frame))
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

    private static func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
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
