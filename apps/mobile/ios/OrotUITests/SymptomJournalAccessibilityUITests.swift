import UIKit
import XCTest

/// Exercises the remaining large-text boundary through the real journal route and its isolated recovery fixture.
final class SymptomJournalAccessibilityUITests: OrotFailFastTestCase {
    @MainActor
    func testLargeKoreanTextKeepsSaveAndCancelReachableAcrossAppearances() throws {
        let app = XCUIApplication()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore journal appearance: \(error)") }
            }
            app.terminate()
        }
        try launchJournal(app, category: .large)
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { original = $0 })
        try openForm(app)
        let baselineFont = assertEnvironment(app, style: .light, category: .large, stage: "default-korean-font")
        app.terminate()
        try launchJournal(app, category: .accessibilityExtraExtraExtraLarge)
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self)
        let description = "오후부터 손끝이 저리고 오래 앉아 있으면 불편해요.\n쉬어도 같은 느낌이 이어져 기록해요."
        try openForm(app)
        fill(app, "symptom-description", description)
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch))
        let largeFont = assertEnvironment(app, style: .light, category: .accessibilityExtraExtraExtraLarge, stage: "large-korean-light")
        XCTAssertGreaterThan(largeFont, baselineFont, "The actual Korean input must grow from its measured default font")
        fill(app, "symptom-onset-date", "2026-10-28")
        try tapFinal(app, "symptom-status-active", stage: "large-korean-active")
        fill(app, "symptom-onset-time", "09:30")
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch))
        // The public form drag may dismiss the real keyboard; final-button containment is still measured before the tap.
        try tapFinal(app, "symptom-save", stage: "large-korean-first-save")
        let error = UITestConditions.element(app, "symptom-form-error")
        XCTAssertTrue(UITestConditions.exists(error))
        XCTAssertEqual(error.label, "증상 기록을 저장하지 못했어요. 다시 시도해 주세요.")
        XCTAssertEqual(app.textViews["symptom-description"].value as? String, description)
        revealText(app, error)
        let hint = app.staticTexts["불편 정도는 선택 입력이며 직접 기록해요."]
        revealText(app, hint)

        // Keep the failed draft in the same process while the existing appearance helper observes UIKit and RN acknowledgement.
        _ = try AppearanceUITestConditions.select(true, returningTo: app, testCase: self)
        XCTAssertEqual(error.label, "증상 기록을 저장하지 못했어요. 다시 시도해 주세요.")
        revealText(app, error)
        let darkFont = assertEnvironment(app, style: .dark, category: .accessibilityExtraExtraExtraLarge, stage: "large-korean-dark-error")
        XCTAssertGreaterThan(darkFont, baselineFont)
        try tapFinal(app, "symptom-save", stage: "large-korean-retry-save")
        let saved = app.staticTexts[description]
        XCTAssertTrue(UITestConditions.exists(saved))
        revealText(app, saved)
        XCTAssertEqual(UITestConditions.element(app, "symptom-save-recovery-2-status").label, "계속되고 있어요")
        XCTAssertFalse(error.exists)

        try openForm(app)
        let canceled = "저장하지 않을 긴 한국어 증상 기록이에요.\n화면을 내려 닫기를 눌러 취소해요."
        fill(app, "symptom-description", canceled)
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch))
        try tapFinal(app, "symptom-form-cancel", stage: "large-korean-cancel")
        XCTAssertFalse(app.staticTexts[canceled].exists)
        XCTAssertTrue(saved.exists)
        XCTAssertTrue(UITestConditions.element(app, "symptom-add").exists)
    }

    /// Request the supported accessibility size; assertEnvironment separately checks its actual effective native trait.
    @MainActor
    private func launchJournal(_ app: XCUIApplication, category: UIContentSizeCategory) throws {
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "symptom-journal-save-recovery",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-UIPreferredContentSizeCategoryName", category.rawValue,
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ] + AppearanceUITestConditions.observationArguments
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let open = UITestConditions.element(app, "symptoms-open")
        FormUITestConditions.reveal(open, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(open.exists && open.isHittable)
        open.tap()
        NavigationUITestConditions.route(app, markers: ["symptoms-title"])
        XCTAssertEqual(UITestConditions.element(app, "symptoms-title").label, "증상 일지")
    }

    @MainActor
    private func openForm(_ app: XCUIApplication) throws {
        try tapFinal(app, "symptom-add", stage: "large-korean-add")
        XCTAssertTrue(UITestConditions.exists(app.textViews["symptom-description"]))
    }

    /// Reuse the existing real-focus and measured-scroll input helper rather than injecting draft state.
    @MainActor
    private func fill(_ app: XCUIApplication, _ identifier: String, _ text: String) {
        let input = identifier == "symptom-description" ? app.textViews[identifier] : app.textFields[identifier]
        XCTAssertTrue(FormUITestConditions.replace(input, with: text, in: app, scrollID: "symptoms-scroll"))
    }

    @MainActor
    private func revealText(_ app: XCUIApplication, _ text: XCUIElement) {
        XCTAssertTrue(UITestConditions.exists(text))
        XCTAssertNotNil(FormUITestConditions.reveal(text, in: app, scrollID: "symptoms-scroll", requireHittable: false))
    }

    /// The existing reveal helper excludes the keyboard and floating navigation controls; record the actual successful target, without a new size threshold.
    @MainActor
    private func tapFinal(_ app: XCUIApplication, _ identifier: String, stage: String) throws {
        let target = UITestConditions.element(app, identifier)
        let frame = try XCTUnwrap(FormUITestConditions.reveal(target, in: app, scrollID: "symptoms-scroll"))
        let hittable = target.exists && target.isHittable
        XCTAssertTrue(hittable)
        let evidence: [String: Any] = [
            "identifier": identifier, "hittable": hittable,
            "frame": ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height],
            "keyboardExists": app.keyboards.firstMatch.exists,
        ]
        let record = try XCTAttachment(data: JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), uniformTypeIdentifier: "public.json")
        record.name = stage + "-touch"
        record.lifetime = .keepAlways
        add(record)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = stage
        screenshot.lifetime = .keepAlways
        add(screenshot)
        target.tap()
    }

    /// Effective window traits and input font come from the existing passive native sample, not from a launch-argument echo.
    @MainActor
    private func assertEnvironment(_ app: XCUIApplication, style: UIUserInterfaceStyle, category: UIContentSizeCategory, stage: String) -> Double {
        let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: self, attachmentName: stage + "-native")
        let trace = snapshot?["symptomScrollTrace"] as? [String: Any]
        let accessory = trace?["descriptionAccessory"] as? [String: Any]
        let inputs = accessory?["inputs"] as? [[String: Any]]
        let geometry = inputs?.first?["geometry"] as? [String: Any]
        XCTAssertEqual(accessory?["truncated"] as? Bool, false)
        XCTAssertEqual(accessory?["inputCount"] as? Int, 1)
        XCTAssertEqual(inputs?.count, 1)
        XCTAssertEqual(geometry?["status"] as? String, "sampled")
        XCTAssertEqual(geometry?["contentSizeCategory"] as? String, category.rawValue)
        XCTAssertEqual(geometry?["isAccessibilityCategory"] as? Bool, category.isAccessibilityCategory)
        XCTAssertEqual(geometry?["userInterfaceStyle"] as? Int, style.rawValue)
        let fontSize = geometry?["fontPointSize"] as? Double ?? 0
        XCTAssertGreaterThan(fontSize, 0)
        return fontSize
    }
}
