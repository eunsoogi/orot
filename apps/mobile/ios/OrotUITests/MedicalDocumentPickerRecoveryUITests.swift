import XCTest

/// Exercises the system pickers and navigation with an isolated synthetic storage boundary.
final class MedicalDocumentPickerRecoveryUITests: OrotFailFastTestCase {
    @MainActor
    func testPhotoPickerCancelRestoresInteraction() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])

        // This isolated-storage probe verifies system cancellation and interaction recovery.
        let photoAction = node(app, "records-import-medical-photo")
        tap(app, "records-import-medical-photo")
        let cancelPhotoPicker = waitForPhotoPicker(app, photoAction, name: "medical-photo-picker-before-cancel")
        cancelPhotoPicker.tap()
        try assertImportActionsReady(app)

        try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        try assertImportActionsReady(app)

        tap(app, "records-import-medical-photo")
        let reopenedCancel = waitForPhotoPicker(app, photoAction, name: "medical-photo-picker-after-cancel-reopen")
        reopenedCancel.tap()
        try assertImportActionsReady(app)

        tapRecordsImportBodyAction(app)
        let filePickerCancel = app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
        XCTAssertTrue(filePickerCancel.waitForExistence(timeout: 5), app.debugDescription)
        capture(app, "medical-file-picker-after-photo-cancel")
        // Preserve the accessibility tree at the same point as the Files screenshot.
        add(XCTAttachment(string: app.debugDescription))
        filePickerCancel.tap()
        try assertImportActionsReady(app)
    }

    @MainActor
    func testPhotoPickerGestureDismissalRestoresInteraction() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])

        let photoAction = node(app, "records-import-medical-photo")
        tap(app, "records-import-medical-photo")
        let pickerCancel = waitForPhotoPicker(app, photoAction, name: "medical-photo-picker-before-gesture-dismissal")
        capture(app, "medical-photo-picker-visible-before-gesture")
        let frame = app.frame
        let origin = app.coordinate(withNormalizedOffset: .zero)
        // The observed sheet begins below the status bar; start above its segmented control.
        let start = origin.withOffset(CGVector(dx: frame.width * 0.5, dy: frame.height * 0.08))
        let end = origin.withOffset(CGVector(dx: frame.width * 0.5, dy: frame.height * 0.82))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(pickerCancel.waitForNonExistence(timeout: 5), app.debugDescription)
        try assertImportActionsReady(app)

        try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-photo")
        let reopenedCancel = waitForPhotoPicker(app, photoAction, name: "medical-photo-picker-after-gesture-reopen")
        reopenedCancel.tap()
        try assertImportActionsReady(app)

        tapRecordsImportBodyAction(app)
        let filePickerCancel = app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
        XCTAssertTrue(filePickerCancel.waitForExistence(timeout: 5), app.debugDescription)
        capture(app, "medical-file-picker-after-photo-dismissal")
        filePickerCancel.tap()
        try assertImportActionsReady(app)
    }

    @MainActor
    func testPhotoPickerRecoversAfterBackgroundAndForeground() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let photoAction = node(app, "records-import-medical-photo")
        tap(app, "records-import-medical-photo")
        let cancel = waitForPhotoPicker(app, photoAction, name: "medical-photo-picker-before-background")

        // The OS may retain or dismiss its picker while the app is inactive; either path must recover.
        XCUIDevice.shared.press(.home)
        let background = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                app.state == .runningBackground || app.state == .runningBackgroundSuspended
            },
            object: nil,
        )
        let backgroundResult = XCTWaiter.wait(for: [background], timeout: 5)
        XCTAssertEqual(backgroundResult, .completed, app.debugDescription)
        guard backgroundResult == .completed else { throw NSError(domain: "MedicalDocumentPickerRecovery", code: 2) }
        app.activate()
        if cancel.exists {
            cancel.tap()
        }
        try assertImportActionsReady(app)
        try NavigationUITestConditions.openTab(app, "home", markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-photo")
        let reopenedCancel = waitForPhotoPicker(app, photoAction, name: "medical-photo-picker-after-foreground")
        reopenedCancel.tap()
        try assertImportActionsReady(app)
        tapRecordsImportBodyAction(app)
        let filePickerCancel = app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
        XCTAssertTrue(filePickerCancel.waitForExistence(timeout: 5), app.debugDescription)
        filePickerCancel.tap()
        try assertImportActionsReady(app)
    }

    @MainActor
    private func waitForPhotoPicker(_ app: XCUIApplication, _ action: XCUIElement, name: String) -> XCUIElement {
        // The waiting label proves JS entered selection; the system Cancel button proves UIKit presented PHPicker.
        let waiting = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "사진을 선택해 주세요."),
            object: action,
        )
        XCTAssertEqual(XCTWaiter.wait(for: [waiting], timeout: 5), .completed, app.debugDescription)
        capture(app, name)
        let cancel = app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), app.debugDescription)
        return cancel
    }

    @MainActor
    private func assertImportActionsReady(_ app: XCUIApplication) throws {
        let photos = node(app, "records-import-medical-photo")
        let files = node(app, "records-import-medical-document")
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                photos.isEnabled && photos.isHittable && files.isEnabled && files.isHittable
            },
            object: nil,
        )
        let result = XCTWaiter.wait(for: [ready], timeout: 5)
        XCTAssertEqual(result, .completed, app.debugDescription)
        guard result == .completed else { throw NSError(domain: "MedicalDocumentPickerRecovery", code: 1) }
        XCTAssertTrue(photos.label.contains("선택한 사진의 글자를 기기에서 읽어요."), photos.debugDescription)
        XCTAssertFalse(photos.label.contains("사진을 선택해 주세요."), photos.debugDescription)
        XCTAssertFalse(node(app, "medical-document-import-status").exists, app.debugDescription)
    }

    @MainActor
    private func launch(_ app: XCUIApplication) {
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "medical-document-picker-recovery",
            "-OROT_TEST_MEDICAL_DOCUMENT_FIXTURE", "text-pdf",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)
        DebugUITestConditions.dismissWarningToast(app)
    }

    /// Verifies the import control belongs to Records' scroll area rather than the navigation rail.
    @MainActor
    private func recordsImportBodyAction(_ app: XCUIApplication) -> XCUIElement {
        let matches = app.buttons.matching(identifier: "records-import-medical-document")
        let action = matches.firstMatch
        XCTAssertTrue(action.waitForAppearance(), app.debugDescription)
        XCTAssertEqual(matches.count, 1, app.debugDescription)
        let page = recordsPage(app)
        FormUITestConditions.reveal(action, in: app, scroll: page)
        XCTAssertTrue(action.isHittable && page.frame.contains(action.frame), app.debugDescription)
        return action
    }

    @MainActor
    private func tapRecordsImportBodyAction(_ app: XCUIApplication) {
        recordsImportBodyAction(app).tap()
    }

    @MainActor
    private func recordsPage(_ app: XCUIApplication) -> XCUIElement {
        // Resolve the tagged route container to the native scroll view that owns the viewport.
        let route = app.descendants(matching: .any).matching(identifier: "navigation-route-scroll")
        XCTAssertEqual(route.count, 1, app.debugDescription)
        let routeContainer = route.firstMatch
        XCTAssertTrue(routeContainer.exists && !routeContainer.frame.isEmpty, app.debugDescription)
        let scrollViews = routeContainer.scrollViews
        XCTAssertEqual(scrollViews.count, 1, app.debugDescription)
        let page = scrollViews.firstMatch
        XCTAssertTrue(page.exists && !page.frame.isEmpty, app.debugDescription)
        XCTAssertEqual(page.scrollViews.count, 0, app.debugDescription)
        return page
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = node(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        FormUITestConditions.reveal(target, in: app, scroll: recordsPage(app))
        XCTAssertTrue(target.isHittable, app.debugDescription)
        target.tap()
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
