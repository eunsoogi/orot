import XCTest

/// Reveals only an overflow item inside its actual system sheet's scroll view.
@MainActor
enum NavigationOverflowSheetUITestConditions {
    static func reveal(_ item: XCUIElement, label: String, in app: XCUIApplication) {
        guard item.exists, !item.isHittable else { return }
        let sheets = app.sheets.allElementsBoundByIndex.filter { $0.buttons[label].exists }
        XCTAssertEqual(sheets.count, 1, "The overflow item must belong to one actual sheet")
        guard let sheet = sheets.first, sheets.count == 1 else { return }
        let scrolls = sheet.scrollViews.allElementsBoundByIndex.filter { $0.buttons[label].exists }
        XCTAssertEqual(scrolls.count, 1, "The overflow item must belong to one sheet scroll view")
        guard let scroll = scrolls.first, scrolls.count == 1 else { return }
        // The bounded existing reveal checks the real target and only scrolls its owner.
        UITestConditions.scrollTo(item, in: scroll)
    }
}

@MainActor
extension NavigationPageActionUITestConditions {
    static func pageAction(_ app: XCUIApplication, id: String, label: String) -> XCUIElement {
        let direct = UITestConditions.element(app, id)
        let overflow = UITestConditions.element(app, "navigation-page-action-overflow")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in direct.exists || overflow.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        if direct.exists {
            return direct
        }
        XCTAssertTrue(overflow.exists && overflow.isHittable, app.debugDescription)
        overflow.tap()
        let item = app.buttons[label]
        XCTAssertTrue(UITestConditions.exists(item), app.debugDescription)
        NavigationOverflowSheetUITestConditions.reveal(item, label: label, in: app)
        XCTAssertGreaterThanOrEqual(item.frame.width, 44)
        XCTAssertGreaterThanOrEqual(item.frame.height, 44)
        return item
    }

    static func tap(_ app: XCUIApplication, id: String, label: String) {
        let target = pageAction(app, id: id, label: label)
        XCTAssertTrue(target.exists && target.isHittable, app.debugDescription)
        target.tap()
    }
}
