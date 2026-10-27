import XCTest

/// Drives UIKit's document picker with app-owned synthetic files and the production Records route.
final class MedicalDocumentImportJourneyUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testTextBasedPdfCanBeReviewedSavedAndOpenedWithProvenance() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, fixture: "text-pdf")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-document")
        selectPickerFile(app, "MedicalDocumentTextFixture.pdf")

        XCTAssertTrue(node(app, "medical-document-review-title").waitForAppearance(), app.debugDescription)
        let reviewedFilename = node(app, "medical-document-review-filename")
        XCTAssertTrue(reviewedFilename.exists, app.debugDescription)
        XCTAssertTrue(UITestConditions.text(reviewedFilename).contains("MedicalDocumentTextFixture.pdf"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-review-description")).contains("자동으로 확정되지 않아요."))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-review-page-0")).contains("1쪽"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-review-text-0")).contains("Synthetic medical document page one"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-review-page-1")).contains("2쪽"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-review-text-1")).contains("Synthetic medical document page two"))
        XCTAssertTrue(node(app, "medical-document-save").exists, app.debugDescription)
        XCTAssertTrue(node(app, "medical-document-cancel").exists, app.debugDescription)
        capture(app, "medical-document-review-before-save")

        tap(app, "medical-document-save")
        let savedSource = node(app, "medical-document-source-0")
        XCTAssertTrue(savedSource.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(savedSource).contains("MedicalDocumentTextFixture.pdf"))
        tap(app, "medical-document-source-0")
        assertSavedSource(app)
        capture(app, "medical-document-source-with-provenance")

        app.terminate()
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "medical-document-source-0")
        assertSavedSource(app)
        capture(app, "medical-document-source-after-relaunch")
    }

    @MainActor
    func testDuplicateImportKeepsSavedOriginalAndProvenance() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, fixture: "text-pdf")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])

        tap(app, "records-import-medical-document")
        selectPickerFile(app, "MedicalDocumentTextFixture.pdf")
        XCTAssertTrue(node(app, "medical-document-review-title").waitForAppearance(), app.debugDescription)
        tap(app, "medical-document-save")
        XCTAssertTrue(node(app, "medical-document-source-0").waitForAppearance(), app.debugDescription)

        tap(app, "records-import-medical-document")
        selectPickerFile(app, "MedicalDocumentTextFixture.pdf")
        XCTAssertTrue(node(app, "medical-document-review-title").waitForAppearance(), app.debugDescription)
        tap(app, "medical-document-save")

        let duplicateStatus = node(app, "medical-document-import-status")
        XCTAssertTrue(duplicateStatus.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(duplicateStatus).contains("같은 문서가 이미 저장되어 있어요."))
        XCTAssertTrue(node(app, "medical-document-source-0").exists)
        tap(app, "medical-document-source-0")
        assertSavedSource(app)
        capture(app, "medical-document-source-after-duplicate-import")
    }

    @MainActor
    func testScannedPdfIsRejectedWithoutSavingSource() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        launch(app, fixture: "scanned-pdf")
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        tap(app, "records-import-medical-document")
        selectPickerFile(app, "MedicalDocumentScannedFixture.pdf")

        let error = node(app, "medical-document-import-status")
        XCTAssertTrue(error.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(error).contains("선택할 수 있는 텍스트가 없는 PDF 페이지는 지원하지 않아요."))
        XCTAssertFalse(node(app, "medical-document-review-title").exists)
        XCTAssertTrue(node(app, "medical-document-source-empty-list").exists)
        XCTAssertFalse(node(app, "medical-document-source-0").exists)
        capture(app, "medical-document-scanned-pdf-rejected")
    }

    @MainActor
    private func launch(_ app: XCUIApplication, fixture: String) {
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_E2E_PROBE", "medical-document-import",
            "-OROT_TEST_MEDICAL_DOCUMENT_FIXTURE", fixture,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        app.launch()
        XCTAssertTrue(node(app, "welcome-title").waitForAppearance(), app.debugDescription)
        DebugUITestConditions.dismissWarningToast(app)
    }

    @MainActor
    private func selectPickerFile(_ app: XCUIApplication, _ filename: String) {
        let displayName = (filename as NSString).deletingPathExtension
        let query = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", displayName),
        )
        let file = query.firstMatch
        XCTAssertTrue(file.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(file.isHittable, app.debugDescription)
        file.tap()
    }

    @MainActor
    private func assertSavedSource(_ app: XCUIApplication) {
        XCTAssertTrue(node(app, "medical-document-source-title").waitForAppearance(), app.debugDescription)
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-source-title")).contains("MedicalDocumentTextFixture.pdf"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-source-review-state")).contains("아직 검토되지 않았어요."))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-source-locator-0")).contains("1쪽 · 위치"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-source-text-0")).contains("Synthetic medical document page one"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-source-locator-1")).contains("2쪽 · 위치"))
        XCTAssertTrue(UITestConditions.text(node(app, "medical-document-source-text-1")).contains("Synthetic medical document page two"))
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        UITestConditions.element(app, identifier)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = node(app, identifier)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
        UITestConditions.scrollTo(target, in: app)
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
