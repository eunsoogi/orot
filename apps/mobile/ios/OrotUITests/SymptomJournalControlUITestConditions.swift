import XCTest

/// Exercises the new native controls while preserving the journal's existing real-keyboard journeys.
@MainActor
enum SymptomJournalControlUITestConditions {
    static func pendingPickerBlocksSave(_ app: XCUIApplication) {
        let date = UITestConditions.element(app, "symptom-onset-choose-date")
        FormUITestConditions.reveal(date, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(date.exists && date.isHittable)
        date.tap()
        let save = UITestConditions.element(app, "symptom-save")
        FormUITestConditions.reveal(save, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(save.exists)
        XCTAssertFalse(save.isEnabled, "Unconfirmed picker values must not be saved")
        let cancel = UITestConditions.element(app, "symptom-onset-picker-cancel")
        FormUITestConditions.reveal(cancel, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()
        XCTAssertTrue(save.isEnabled)
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
        let cancel = UITestConditions.element(app, "symptom-onset-picker-cancel")
        FormUITestConditions.reveal(cancel, in: app, scrollID: "symptoms-scroll")
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()
        XCTAssertEqual(date.label, original)
        XCTAssertFalse(app.datePickers.firstMatch.exists)
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
}
