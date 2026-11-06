import XCTest

/// Preserves one before/after observation without waiting for menu items or changing the normal journey.
@MainActor
enum FoldedMenuDiagnostic {
    static func capture(_ app: XCUIApplication, testCase: XCTestCase) throws {
        let more = app.buttons["navigation-page-action-overflow"]
        let matches = app.buttons.matching(identifier: "navigation-page-action-overflow")
        let keyboard = app.keyboards.firstMatch
        let before = Date().timeIntervalSince1970 * 1000
        let state = "atMs=\(before) count=\(matches.count) exists=\(more.exists) enabled=\(more.exists && more.isEnabled) hittable=\(more.exists && more.isHittable) frame=\(more.exists ? String(describing: more.frame) : "unavailable") keyboardExists=\(keyboard.exists) keyboardFrame=\(keyboard.exists ? String(describing: keyboard.frame) : "unavailable")"
        attach(state, name: "folded-menu-before-state", testCase: testCase)
        _ = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "folded-menu-before-native")
        let beforeTree = try app.snapshot()
        attach(FeatureEntryDuoActionConditions.snapshotEvidence(beforeTree), name: "folded-menu-before-snapshot", testCase: testCase)
        guard matches.count == 1, more.exists, more.isEnabled, more.isHittable else {
            throw NSError(domain: "FoldedMenuDiagnostic", code: 1, userInfo: [NSLocalizedDescriptionKey: "More is not uniquely enabled and hittable"])
        }
        let tapped = Date().timeIntervalSince1970 * 1000
        more.tap()
        let returned = Date().timeIntervalSince1970 * 1000
        attach("tapStartMs=\(tapped) tapReturnMs=\(returned)", name: "folded-menu-tap-times", testCase: testCase)
        _ = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: "folded-menu-after-native")
        let afterTree = try app.snapshot()
        attach(FeatureEntryDuoActionConditions.snapshotEvidence(afterTree), name: "folded-menu-after-snapshot", testCase: testCase)
        var sheets = 0
        var items = 0
        func count(_ node: XCUIElementSnapshot) {
            if node.elementType == .sheet {
                sheets += 1
            }
            if node.elementType == .button, ["대화 목록", "새 대화", "동작 메뉴 닫기"].contains(node.label) {
                items += 1
            }
            node.children.forEach(count)
        }
        count(afterTree)
        attach("sheetCount=\(sheets) matchingMenuButtonCount=\(items)", name: "folded-menu-after-counts", testCase: testCase)
    }

    private static func attach(_ value: String, name: String, testCase: XCTestCase) {
        let attachment = XCTAttachment(string: value)
        attachment.name = name
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }
}
