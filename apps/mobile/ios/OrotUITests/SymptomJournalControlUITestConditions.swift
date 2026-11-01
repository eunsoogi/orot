import XCTest

/// Exercises the new native controls while preserving the journal's existing real-keyboard journeys.
@MainActor
enum SymptomJournalControlUITestConditions {
    static func tapPageAction(_ app: XCUIApplication, id: String, label: String) -> Bool {
        let target = NavigationPageActionUITestConditions.pageAction(app, id: id, label: label)
        let hittable = target.exists && target.isHittable
        XCTAssertTrue(hittable, app.debugDescription)
        guard hittable else { return false }
        target.tap()
        return true
    }

    /// Observe the dock anchor before opening overflow, and require actual form movement.
    static func assertDockStaysFixedDuringFormScroll(_ app: XCUIApplication, testCase: XCTestCase) {
        let direct = UITestConditions.element(app, "symptom-form-cancel")
        let overflow = UITestConditions.element(app, "navigation-page-action-overflow")
        let anchor = direct.exists ? direct : overflow
        let scroll = UITestConditions.element(app, "symptoms-scroll")
        XCTAssertTrue(anchor.exists && anchor.isHittable && scroll.exists, app.debugDescription)
        let beforeAnchor = anchor.frame
        let before = scrollSample(app, testCase: testCase, name: "dock-before-scroll")
        scroll.swipeUp()
        let afterAnchor = anchor.frame
        let after = scrollSample(app, testCase: testCase, name: "dock-after-scroll")
        XCTAssertNotNil(before)
        XCTAssertNotNil(after)
        if let before, let after {
            XCTAssertEqual(before.id, after.id, "Observe the same native scroll view")
            XCTAssertGreaterThan(after.offset, before.offset, "The form must actually move")
            print("Dock scroll evidence: beforeOffset=\(before.offset), afterOffset=\(after.offset), beforeAnchor=\(beforeAnchor), afterAnchor=\(afterAnchor), window=\(app.frame), scroll=\(scroll.frame), hittable=\(anchor.isHittable)")
        }
        XCTAssertEqual(afterAnchor.minX, beforeAnchor.minX, accuracy: 1)
        XCTAssertEqual(afterAnchor.minY, beforeAnchor.minY, accuracy: 1)
        XCTAssertEqual(afterAnchor.width, beforeAnchor.width, accuracy: 1)
        XCTAssertEqual(afterAnchor.height, beforeAnchor.height, accuracy: 1)
        XCTAssertTrue(app.frame.contains(afterAnchor) && anchor.isHittable, app.debugDescription)
        let back = UITestConditions.element(app, "navigation-back")
        if back.exists {
            XCTAssertFalse(afterAnchor.intersects(back.frame), app.debugDescription)
        }
        scroll.swipeDown()
    }

    private static func scrollSample(_ app: XCUIApplication, testCase: XCTestCase, name: String) -> (id: String, offset: Double)? {
        let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: testCase, attachmentName: name)
        guard let trace = snapshot?["symptomScrollTrace"] as? [String: Any],
              let accessory = trace["descriptionAccessory"] as? [String: Any],
              accessory["truncated"] as? Bool == false,
              let inputs = accessory["inputs"] as? [[String: Any]], inputs.count == 1,
              let geometry = inputs[0]["geometry"] as? [String: Any], geometry["status"] as? String == "sampled",
              let interaction = geometry["interaction"] as? [String: Any],
              let scroll = interaction["scroll"] as? [String: Any],
              let view = scroll["view"] as? [String: Any], let id = view["identity"] as? String,
              let offset = scroll["contentOffset"] as? [String: Any], let y = offset["y"] as? Double, y.isFinite
        else { return nil }
        return (id, y)
    }

    static func tapAccessory(_ app: XCUIApplication, id: String) {
        let button = UITestConditions.element(app, id)
        XCTAssertTrue(UITestConditions.exists(button) && button.isHittable)
        button.tap()
    }

    static func confirmedPickerPersists(_ app: XCUIApplication) {
        let description = app.textViews["symptom-description"]
        XCTAssertTrue(FormUITestConditions.replace(description, with: "Synthetic picker onset", in: app, scrollID: "symptoms-scroll"))
        let status = UITestConditions.element(app, "symptom-status-active")
        FormUITestConditions.reveal(status, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(status.exists && status.isHittable)
        status.tap()
        let date = UITestConditions.element(app, "symptom-onset-choose-date")
        FormUITestConditions.reveal(date, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(date.exists && date.isHittable)
        let original = date.label
        date.tap()
        let wheel = app.pickerWheels.element(boundBy: 0)
        XCTAssertTrue(wheel.exists && wheel.isHittable)
        let before = wheel.value as? String
        wheel.swipeUp()
        XCTAssertNotEqual(wheel.value as? String, before)
        let done = UITestConditions.element(app, "symptom-onset-picker-done")
        FormUITestConditions.reveal(done, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(done.exists && done.isHittable)
        done.tap()
        XCTAssertNotEqual(date.label, original)
        let manual = UITestConditions.element(app, "symptom-onset-manual")
        FormUITestConditions.reveal(manual, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(manual.exists && manual.isHittable)
        manual.tap()
        let selectedDate = app.textFields["symptom-onset-date"].value as? String ?? ""
        let selectedTime = app.textFields["symptom-onset-time"].value as? String ?? ""
        let inputFormat = DateFormatter()
        inputFormat.locale = Locale(identifier: "en_US_POSIX")
        inputFormat.dateFormat = "yyyy-MM-dd"
        guard let parsedDate = inputFormat.date(from: selectedDate) else {
            XCTFail("Picker must expose a valid selected local date")
            return
        }
        inputFormat.dateFormat = "yyyy년 M월 d일"
        let save = NavigationPageActionUITestConditions.pageAction(app, id: "symptom-save", label: "증상 기록 저장")
        XCTAssertTrue(save.exists && save.isHittable && save.isEnabled)
        save.tap()
        let onset = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'symptom-' AND identifier ENDSWITH '-onset'")).firstMatch
        XCTAssertTrue(UITestConditions.exists(onset))
        XCTAssertTrue(UITestConditions.text(onset).contains(inputFormat.string(from: parsedDate)))
        XCTAssertTrue(UITestConditions.text(onset).contains(selectedTime))
    }

    static func pendingPickerBlocksSave(_ app: XCUIApplication) {
        let date = UITestConditions.element(app, "symptom-onset-choose-date")
        FormUITestConditions.reveal(date, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(date.exists && date.isHittable)
        date.tap()
        let save = NavigationPageActionUITestConditions.pageAction(app, id: "symptom-save", label: "증상 기록 저장")
        XCTAssertTrue(save.exists)
        XCTAssertFalse(save.isEnabled, "Unconfirmed picker values must not be saved")
        if app.buttons["동작 메뉴 닫기"].exists {
            app.buttons["동작 메뉴 닫기"].tap()
        }
        let cancel = UITestConditions.element(app, "symptom-onset-picker-cancel")
        FormUITestConditions.reveal(cancel, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()
        let enabledSave = NavigationPageActionUITestConditions.pageAction(app, id: "symptom-save", label: "증상 기록 저장")
        XCTAssertTrue(enabledSave.isEnabled)
        if app.buttons["동작 메뉴 닫기"].exists {
            app.buttons["동작 메뉴 닫기"].tap()
        }
    }

    static func directFormAndPickerCancellation(_ app: XCUIApplication) {
        XCTAssertFalse(UITestConditions.element(app, "symptom-filter-active").exists)
        XCTAssertFalse(UITestConditions.element(app, "symptoms-selected-summary").exists)
        let date = UITestConditions.element(app, "symptom-onset-choose-date")
        FormUITestConditions.reveal(date, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(date.exists && date.isHittable)
        let original = date.label
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyy-MM-dd"
        // The formatter deliberately keeps the device time zone, as does the product picker.
        XCTAssertTrue(original.contains(format.string(from: Date())))
        date.tap()
        XCTAssertTrue(UITestConditions.exists(app.datePickers.firstMatch))
        XCTAssertGreaterThan(app.pickerWheels.count, 0)
        // Change a real native wheel before cancelling; the displayed draft must stay unchanged.
        let wheel = app.pickerWheels.element(boundBy: 0)
        XCTAssertTrue(wheel.exists && wheel.isHittable)
        let before = wheel.value as? String
        wheel.swipeUp()
        XCTAssertNotEqual(wheel.value as? String, before)
        let cancel = UITestConditions.element(app, "symptom-onset-picker-cancel")
        FormUITestConditions.reveal(cancel, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()
        XCTAssertEqual(date.label, original)
        XCTAssertFalse(app.datePickers.firstMatch.exists)
        FormUITestConditions.reveal(date, in: app, scrollID: "symptoms-scroll")
        date.tap()
        let confirmedWheel = app.pickerWheels.element(boundBy: 0)
        XCTAssertTrue(confirmedWheel.exists && confirmedWheel.isHittable)
        let beforeConfirmation = confirmedWheel.value as? String
        confirmedWheel.swipeUp()
        XCTAssertNotEqual(confirmedWheel.value as? String, beforeConfirmation)
        let done = UITestConditions.element(app, "symptom-onset-picker-done")
        FormUITestConditions.reveal(done, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(done.exists && done.isHittable)
        done.tap()
        XCTAssertNotEqual(date.label, original)
    }

    static func sliderRecordsExplicitEndpointsAndCanReturnToMissing(_ app: XCUIApplication) {
        let slider = app.sliders["symptom-severity-slider"]
        FormUITestConditions.reveal(slider, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(slider.exists && slider.isHittable)
        slider.adjust(toNormalizedSliderPosition: 1)
        XCTAssertEqual(app.textFields["symptom-severity"].value as? String, "10")
        slider.adjust(toNormalizedSliderPosition: 0)
        XCTAssertEqual(app.textFields["symptom-severity"].value as? String, "0")
        let clear = UITestConditions.element(app, "symptom-severity-clear")
        FormUITestConditions.reveal(clear, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(clear.exists && clear.isHittable)
        clear.tap()
        XCTAssertEqual(UITestConditions.element(app, "symptom-severity-selection").label, "입력 안 함")
    }

    static func resolutionRetriesWithoutLosingInlineEntry(_ app: XCUIApplication, id: String) {
        let select = UITestConditions.element(app, "symptom-select-" + id)
        FormUITestConditions.reveal(select, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(select.exists && select.isHittable)
        select.tap()
        XCTAssertEqual(UITestConditions.element(app, "symptom-" + id + "-severity-missing").label, "입력 안 함")
        let resolve = UITestConditions.element(app, "symptom-resolve-" + id)
        FormUITestConditions.reveal(resolve, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(resolve.exists && resolve.isHittable)
        resolve.tap()
        let error = UITestConditions.element(app, "symptoms-error")
        XCTAssertTrue(UITestConditions.exists(error))
        XCTAssertEqual(UITestConditions.element(app, "symptom-" + id + "-status").label, "계속되고 있어요")
        XCTAssertTrue(UITestConditions.element(app, "symptoms-selected-summary").exists)
        XCTAssertEqual(resolve.label, "다시 시도")
        FormUITestConditions.reveal(resolve, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(resolve.isHittable)
        resolve.tap()
        UITestConditions.value(UITestConditions.element(app, "symptom-" + id + "-status"), equals: "나아졌어요")
        XCTAssertFalse(error.exists)
    }

    /// Type only through a visible native key and require the actual controlled value to change.
    static func typeVisibleLetter(_ app: XCUIApplication, previous: String) -> String? {
        let description = app.textViews["symptom-description"]
        guard let before = description.value as? String, before == previous else {
            XCTFail("The focused draft must match the previously observed value"); return nil
        }
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists, let letter = ["Q", "W", "q", "w"].map({ keyboard.keys[$0] }).first(where: { $0.exists && $0.isHittable }), app.frame.intersects(keyboard.frame),
              FormScrollGeometry.valid(keyboard.frame), FormScrollGeometry.valid(letter.frame),
              keyboard.frame.contains(letter.frame), app.frame.contains(letter.frame)
        else {
            XCTFail("A visible keyboard letter is required for the edit"); return nil
        }
        letter.tap()
        guard let changed = description.value as? String, changed != before else {
            XCTFail("The real keyboard tap must change the draft"); return nil
        }
        return changed
    }
}
