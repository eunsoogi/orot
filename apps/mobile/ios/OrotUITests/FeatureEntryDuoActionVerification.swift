import XCTest

/// Verifies direct or overflow conversation actions in the measured Duo lane.
@MainActor
extension FeatureEntryDuoActionConditions {
    static func verify(_ app: XCUIApplication, toolbar: XCUIElement, viewport: CGRect) throws {
        let history = UITestConditions.element(app, "rag-conversation-sessions-toggle")
        let newSession = UITestConditions.element(app, "rag-conversation-new-session")
        if history.exists, newSession.exists {
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "rag-conversation-sessions-toggle").count, 1)
            XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "rag-conversation-new-session").count, 1)
            for (action, label) in [(history, "대화 목록"), (newSession, "새 대화")] {
                XCTAssertTrue(action.isHittable && action.isEnabled && action.label.contains(label), app.debugDescription)
                XCTAssertGreaterThanOrEqual(action.frame.width, 44)
                XCTAssertGreaterThanOrEqual(action.frame.height, 44)
                XCTAssertTrue(toolbar.frame.insetBy(dx: -1, dy: -1).contains(action.frame))
                XCTAssertGreaterThanOrEqual(action.frame.minX, viewport.maxX - 0.5)
            }
            XCTAssertLessThan(history.frame.minY, newSession.frame.minY)
            XCTAssertFalse(history.frame.intersects(newSession.frame))
            return
        }
        // The shared dock uses the system sheet when the toolbar cannot fit both actions.
        let more = app.buttons["navigation-page-action-overflow"]
        XCTAssertEqual(app.buttons.matching(identifier: "navigation-page-action-overflow").count, 1)
        XCTAssertTrue(more.exists && more.isHittable && more.isEnabled, app.debugDescription)
        XCTAssertGreaterThanOrEqual(more.frame.width, 44)
        XCTAssertGreaterThanOrEqual(more.frame.height, 44)
        XCTAssertTrue(toolbar.frame.insetBy(dx: -1, dy: -1).contains(more.frame))
        XCTAssertGreaterThanOrEqual(more.frame.minX, viewport.maxX - 0.5)
        more.tap()
        let sheet = app.sheets.firstMatch
        XCTAssertTrue(sheet.exists, app.debugDescription)
        let items = ["대화 목록", "새 대화", "동작 메뉴 닫기"].map { label -> XCUIElement in
            let matches = app.buttons.matching(NSPredicate(format: "label == %@", label))
            XCTAssertEqual(matches.count, 1, app.debugDescription)
            let item = matches.firstMatch
            XCTAssertTrue(item.exists && item.isHittable && item.isEnabled, app.debugDescription)
            XCTAssertTrue(sheet.frame.insetBy(dx: -1, dy: -1).contains(item.frame))
            let visible = item.frame.intersection(app.frame)
            XCTAssertGreaterThanOrEqual(visible.width, 44)
            XCTAssertGreaterThanOrEqual(visible.height, 44)
            return item
        }
        XCTAssertLessThan(items[0].frame.minY, items[1].frame.minY)
        XCTAssertFalse(items[0].frame.intersects(items[1].frame))
        items[2].tap()
        XCTAssertFalse(sheet.exists, "Closing the action sheet must return to the conversation")
    }
}
