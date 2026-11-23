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
    /// Keep the saved-summary precondition strict without running the unrelated assessment.
    static func verifySummaryAssessmentIsReachable(_ app: XCUIApplication) throws {
        let destination = "disease-hypotheses-screen"
        let summary = "symptom-summary-generate"
        let assessment = "disease-hypotheses-generate"
        let more = "navigation-page-action-overflow"
        assertToolbar(app, marker: destination, actions: [summary])
        let direct = app.buttons[assessment]
        let overflow = app.buttons[more]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (direct.exists && direct.isEnabled && direct.isHittable) ||
                (overflow.exists && overflow.isEnabled && overflow.isHittable)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        if direct.exists, direct.isHittable {
            XCTAssertTrue(direct.isEnabled)
            assertToolbar(app, marker: destination, actions: [summary, assessment] + (overflow.exists ? [more] : []))
            return
        }

        assertToolbar(app, marker: destination, actions: [summary, more])
        XCTAssertTrue(overflow.isEnabled)
        overflow.tap()
        let sheets = app.sheets
        XCTAssertTrue(UITestConditions.exists(sheets.firstMatch))
        XCTAssertEqual(sheets.count, 1)
        let sheet = sheets.firstMatch
        let label = "가능성 살펴보기"
        let assessmentItems = sheet.buttons.matching(NSPredicate(format: "label == %@", label))
        let item = assessmentItems.firstMatch
        XCTAssertTrue(UITestConditions.exists(item))
        XCTAssertEqual(assessmentItems.count, 1)
        NavigationOverflowSheetUITestConditions.reveal(item, label: label, in: app)
        let closeItems = sheet.buttons.matching(NSPredicate(format: "label == %@", "동작 메뉴 닫기"))
        XCTAssertEqual(closeItems.count, 1)
        let close = closeItems.firstMatch
        for control in [item, close] {
            XCTAssertTrue(control.exists && control.isEnabled && control.isHittable)
            XCTAssertTrue(sheet.frame.insetBy(dx: -1, dy: -1).contains(control.frame))
            let visible = control.frame.intersection(app.frame)
            XCTAssertGreaterThanOrEqual(visible.width, 44)
            XCTAssertGreaterThanOrEqual(visible.height, 44)
        }
        XCTAssertFalse(item.frame.intersects(close.frame))
        // Use the actual menu's Cancel control, not the assessment or an arbitrary outside tap.
        close.tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !sheet.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [dismissed]), .completed)
        assertToolbar(app, marker: destination, actions: [summary])
    }

    static func pageAction(_ app: XCUIApplication, id: String, label: String) -> XCUIElement {
        let direct = app.buttons.matching(identifier: id).firstMatch
        let overflow = app.buttons["navigation-page-action-overflow"]
        // Keyboard reflow can leave a stale accessibility node after the dock moves an action into More.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (direct.exists && direct.isHittable) || (overflow.exists && overflow.isHittable)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        if direct.exists, direct.isHittable {
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
