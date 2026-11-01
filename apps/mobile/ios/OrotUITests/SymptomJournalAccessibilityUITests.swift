import UIKit
import XCTest

/// Exercises large-text journal actions through the real route and an isolated recovery fixture.
final class SymptomJournalAccessibilityUITests: OrotFailFastTestCase {
    @MainActor
    func testLargeKoreanTextKeepsSaveAndCancelReachableAcrossAppearances() throws {
        if SymptomDateSelectionUITestObservation.enabled {
            SymptomDateSelectionUITestObservation.verifyCorrelation()
        }
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
        guard fill(app, "symptom-description", description) else { return }
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch))
        let largeFont = assertEnvironment(app, style: .light, category: .accessibilityExtraExtraExtraLarge, stage: "large-korean-light")
        XCTAssertGreaterThan(largeFont, baselineFont, "The actual Korean input must grow from its measured default font")
        guard fill(app, "symptom-onset-date", "2026-10-28") else { return }
        try tapFinal(app, "symptom-status-active", stage: "large-korean-active")
        guard fill(app, "symptom-onset-time", "09:30") else { return }
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
        guard fill(app, "symptom-description", canceled) else { return }
        XCTAssertTrue(UITestConditions.exists(app.keyboards.firstMatch))
        try tapFinal(app, "symptom-form-cancel", stage: "large-korean-cancel")
        let discard = app.alerts["저장하지 않은 내용이 있어요"].buttons["내용 버리고 나가기"]
        XCTAssertTrue(UITestConditions.exists(discard) && discard.isHittable)
        discard.tap()
        XCTAssertFalse(app.staticTexts[canceled].exists)
        XCTAssertTrue(saved.exists)
        XCTAssertTrue(UITestConditions.element(app, "symptom-add").exists)
    }

    /// Edit a valid synthetic record through real controls before the first keyboard focus.
    @MainActor
    func testLargeTextKeyboardKeepsSaveAndCancelActionsUsable() throws {
        let app = XCUIApplication()
        var original: AppearanceUITestConditions.Snapshot?
        defer {
            if let original {
                do { try AppearanceUITestConditions.restore(original, returningTo: app, testCase: self) }
                catch { XCTFail("Could not restore journal appearance: \(error)") }
            }
            app.terminate()
        }
        try launchJournal(app, category: .accessibilityExtraExtraExtraLarge, editFixture: true)
        _ = try AppearanceUITestConditions.select(false, returningTo: app, testCase: self, captureOriginal: { original = $0 })
        guard try openSeededEdit(app), adjustSeverity(app, value: 0.6, expected: "6") else { return }
        guard focusDescription(app) else { return }
        _ = assertEnvironment(app, style: .light, category: .accessibilityExtraExtraExtraLarge, stage: "large-keyboard-save")
        guard try tapKeyboardAction(app, id: "symptom-save", label: "변경 사항 저장") else { return }
        guard try openSeededEdit(app) else { return }
        XCTAssertEqual(app.textViews["symptom-description"].value as? String, "아픔")
        XCTAssertEqual(app.textFields["symptom-severity"].value as? String, "6")
        guard adjustSeverity(app, value: 0.8, expected: "8"), focusDescription(app) else { return }
        guard try tapKeyboardAction(app, id: "symptom-form-cancel", label: "취소") else { return }
        let alert = app.alerts["저장하지 않은 내용이 있어요"], keep = alert.buttons["계속 편집"]
        XCTAssertTrue(UITestConditions.exists(keep) && keep.isHittable); keep.tap()
        XCTAssertEqual(app.textFields["symptom-severity"].value as? String, "8")
        guard focusDescription(app) else { return }
        guard try tapKeyboardAction(app, id: "symptom-form-cancel", label: "취소") else { return }
        let discard = alert.buttons["내용 버리고 나가기"]
        XCTAssertTrue(UITestConditions.exists(discard) && discard.isHittable); discard.tap()
        guard try openSeededEdit(app) else { return }
        XCTAssertEqual(app.textFields["symptom-severity"].value as? String, "6")
        XCTAssertEqual(app.textViews["symptom-description"].value as? String, "아픔")
    }

    /// Operate the seeded card through the same selection and edit actions as a user.
    @MainActor
    private func openSeededEdit(_ app: XCUIApplication) throws -> Bool {
        if !UITestConditions.element(app, "symptom-edit-keyboard-seed").exists {
            try tapFinal(app, "symptom-select-keyboard-seed", stage: "large-keyboard-select")
        }
        try tapFinal(app, "symptom-edit-keyboard-seed", stage: "large-keyboard-edit")
        let exists = UITestConditions.exists(app.textViews["symptom-description"])
        XCTAssertTrue(exists)
        return exists
    }

    /// Change the existing value without typing, then verify the same form reflects the slider action.
    @MainActor
    private func adjustSeverity(_ app: XCUIApplication, value: CGFloat, expected: String) -> Bool {
        let slider = app.sliders["symptom-severity-slider"]
        guard FormUITestConditions.reveal(slider, in: app, scrollID: "symptoms-scroll") != nil else { return false }
        guard slider.exists, slider.isHittable else { XCTFail("Severity slider must be tappable"); return false }
        slider.adjust(toNormalizedSliderPosition: value)
        XCTAssertEqual(app.textFields["symptom-severity"].value as? String, expected)
        return true
    }

    /// Request the actual software keyboard by tapping the existing description without changing it.
    @MainActor
    private func focusDescription(_ app: XCUIApplication) -> Bool {
        let input = app.textViews["symptom-description"]
        guard FormUITestConditions.reveal(input, in: app, scrollID: "symptoms-scroll") != nil else { return false }
        guard input.exists, input.isHittable else { XCTFail("Description must be tappable"); return false }
        input.tap(); XCTAssertEqual(input.value as? String, "아픔"); return true
    }

    /// Capture a real on-screen keyboard and an unobscured, tappable page action before activation.
    @MainActor
    private func tapKeyboardAction(_ app: XCUIApplication, id: String, label: String) throws -> Bool {
        let action = NavigationPageActionUITestConditions.pageAction(app, id: id, label: label)
        let keyboard = app.keyboards.firstMatch, window = app.frame
        guard action.exists, action.isHittable, keyboard.exists else { XCTFail("Action and keyboard must be present and hittable"); return false }
        let actionFrame = action.frame, keyboardFrame = keyboard.frame
        guard FormScrollGeometry.valid(window), FormScrollGeometry.valid(actionFrame), FormScrollGeometry.valid(keyboardFrame),
              window.intersects(keyboardFrame), window.contains(actionFrame), !actionFrame.intersects(keyboardFrame)
        else {
            XCTFail("Page action must remain in the window outside the visible keyboard"); return false
        }
        XCTContext.runActivity(named: "Keyboard action: window=\(window), action=\(actionFrame), keyboard=\(keyboardFrame)") { _ in }
        action.tap(); return true
    }

    /// Request the supported accessibility size; assertEnvironment separately checks its actual effective native trait.
    @MainActor
    private func launchJournal(_ app: XCUIApplication, category: UIContentSizeCategory, recovery: Bool = true, editFixture: Bool = false) throws {
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-UIPreferredContentSizeCategoryName", category.rawValue,
            "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ] + (recovery ? ["-OROT_E2E_PROBE", "symptom-journal-save-recovery"] : []) + (editFixture ? ["-OROT_SYMPTOM_EDIT_FIXTURE", "YES"] : []) + AppearanceUITestConditions.observationArguments + (SymptomDateSelectionUITestObservation.enabled ? ["-OROT_TEST_DATE_SELECTION_OBSERVATION", SymptomDateSelectionUITestObservation.session] : [])
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
        SymptomJournalUITestObservations.openManualOnset(app)
        XCTAssertTrue(UITestConditions.exists(app.textViews["symptom-description"]))
    }

    /// Keep the failed XCTest assertion while letting callers stop before dependent keyboard or Save steps.
    @MainActor
    private func fill(_ app: XCUIApplication, _ identifier: String, _ text: String) -> Bool {
        let input = identifier == "symptom-description" ? app.textViews[identifier] : app.textFields[identifier]
        // The date field's command shortcut left existing text after deletion; verify the full selection before editing.
        let completed = FormUITestConditions.replace(input, with: text, in: app, scrollID: "symptoms-scroll", useNativeSelectAllMenu: identifier == "symptom-onset-date")
        XCTAssertTrue(completed)
        return completed
    }

    @MainActor
    private func revealText(_ app: XCUIApplication, _ text: XCUIElement) {
        XCTAssertTrue(UITestConditions.exists(text))
        XCTAssertNotNil(FormUITestConditions.reveal(text, in: app, scrollID: "symptoms-scroll", requireHittable: false))
    }

    /// The existing reveal helper excludes the keyboard and floating navigation controls; record the actual successful target, without a new size threshold.
    @MainActor
    private func tapFinal(_ app: XCUIApplication, _ identifier: String, stage: String) throws {
        let labels = ["symptom-add": "증상 기록 추가", "symptom-save": "증상 기록 저장", "symptom-form-cancel": "취소"]
        let target = labels[identifier].map { NavigationPageActionUITestConditions.pageAction(app, id: identifier, label: $0) } ?? UITestConditions.element(app, identifier)
        let frame = labels[identifier] != nil ? target.frame : try XCTUnwrap(FormUITestConditions.reveal(target, in: app, scrollID: "symptoms-scroll"))
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
