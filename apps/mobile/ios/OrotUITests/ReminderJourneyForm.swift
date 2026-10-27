import XCTest

/// Drives production navigation and the persisted manual form using synthetic text only.
@MainActor
enum ReminderJourneyForm {
    static let clinic = "선택한 합성 진료 예약이며 긴 한국어 문장과 준비할 내용을 화면에서 끝까지 확인합니다"
    static let note = "개인 건강 정보가 아닌 합성 메모입니다. 최근 변화와 확인할 질문을 빠뜨리지 않고 읽을 수 있는지 검사합니다."

    static func start(_ app: XCUIApplication, session: String, large: Bool = false, diagnosticRunID: String? = nil) throws {
        // No E2E/scenario override: the bundled test entry renders the normal App.
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-OROT_TEST_REMINDER_OBSERVATION", "YES",
                               "-OROT_TEST_REMINDER_SESSION", session, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            + AppearanceUITestConditions.observationArguments
        if large {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        if let diagnosticRunID {
            app.launchEnvironment["OROT_TEST_REMINDER_DIAGNOSTICS"] = "YES"
            app.launchEnvironment["OROT_TEST_REMINDER_DIAGNOSTIC_RUN_ID"] = diagnosticRunID
        }
        app.launch()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "welcome-title")))
        XCTAssertFalse(UITestConditions.element(app, "home-appointments-retry").exists)
        try openAppointments(app, fromHome: true)
    }

    static func openAppointments(_ app: XCUIApplication, fromHome: Bool = false) throws {
        if !fromHome {
            try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        }
        try NavigationUITestConditions.openTab(app, "schedule", markers: ["calendar-title"])
        let manage = UITestConditions.element(app, "schedule-open-appointments")
        FormUITestConditions.reveal(manage, in: app, scrollID: "calendar-screen")
        XCTAssertTrue(manage.isHittable)
        manage.tap()
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "appointment-add")))
    }

    /// Verifies a narrow, explanatory appointment form and keeps its actions reachable above the keyboard.
    static func assertAppointmentForm(_ app: XCUIApplication, clinic: String) {
        let panel = UITestConditions.element(app, "appointments-columns-primary")
        XCTAssertTrue(UITestConditions.exists(panel), app.debugDescription)
        let panelFrame = panel.frame
        let form = UITestConditions.element(app, "appointment-form")
        XCTAssertTrue(UITestConditions.exists(form), app.debugDescription)
        let formFrame = form.frame
        XCTAssertLessThanOrEqual(formFrame.width, min(560, panelFrame.width) + 1, app.debugDescription)
        XCTAssertEqual(formFrame.midX, panelFrame.midX, accuracy: 1)

        let explanation = UITestConditions.element(app, "appointment-form-explanation")
        XCTAssertEqual(UITestConditions.text(explanation), "진료 예약 정보를 이 기기에 저장해요.")
        let clinicInput = UITestConditions.element(app, "appointment-clinic-input")
        XCTAssertEqual(clinicInput.value as? String, clinic, app.debugDescription)
        for identifier in ["appointment-date-input", "appointment-time-input", "appointment-note-input"] {
            XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, identifier)), app.debugDescription)
        }
        XCTAssertNotNil(FormUITestConditions.reveal(clinicInput, in: app, scrollID: "appointments-scroll"))
        clinicInput.tap()
        XCTAssertTrue(app.keyboards.firstMatch.exists, app.debugDescription)
        for identifier in ["appointment-save", "appointment-form-cancel"] {
            let action = UITestConditions.element(app, identifier)
            let visibleFrame = FormUITestConditions.reveal(action, in: app, scrollID: "appointments-scroll")
            XCTAssertNotNil(visibleFrame, app.debugDescription)
            XCTAssertTrue(action.isHittable, app.debugDescription)
        }
    }

    static func time(minutesAhead: Int) -> Date {
        let future = Date().addingTimeInterval(Double(minutesAhead) * 60)
        return Calendar.current.date(from: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: future))!
    }

    /// Default-argument expressions are nonisolated; resolve actor-isolated fixtures in the method body.
    static func create(_ app: XCUIApplication, clinic: String, start: Date, note: String? = nil) throws -> String {
        tap(app, "appointment-add")
        fill(app, clinic: clinic, start: start, note: note ?? ReminderJourneyForm.note)
        let label = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", "appointment-clinic-", clinic)).firstMatch
        XCTAssertTrue(UITestConditions.exists(label))
        return String(label.identifier.dropFirst("appointment-clinic-".count))
    }

    static func edit(_ app: XCUIApplication, id: String, start: Date, clinic: String? = nil) {
        tap(app, "appointment-edit-" + id)
        fill(app, clinic: clinic ?? ReminderJourneyForm.clinic, start: start, note: note)
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "appointment-edit-" + id)))
    }

    private static func fill(_ app: XCUIApplication, clinic: String, start: Date, note: String) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        let date = formatter.string(from: start)
        formatter.dateFormat = "HH:mm"
        for (field, value) in [("clinic", clinic), ("date", date), ("time", formatter.string(from: start)), ("note", note)] {
            let input = app.textFields.matching(identifier: "appointment-\(field)-input").firstMatch
            XCTAssertTrue(UITestConditions.exists(input))
            FormUITestConditions.replace(input, with: value, in: app, scrollID: "appointments-scroll")
        }
        app.textFields.matching(identifier: "appointment-note-input").firstMatch.typeText("\n")
        tap(app, "appointment-save")
    }

    static func tap(_ app: XCUIApplication, _ identifier: String) {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        FormUITestConditions.reveal(target, in: app, scrollID: "appointments-scroll")
        XCTAssertTrue(target.isHittable)
        target.tap()
    }

    static func inspectControls(_ app: XCUIApplication, id: String, name: String, testCase: XCTestCase) {
        for identifier in ["appointment-reminder-\(id)-60", "appointment-reminder-\(id)-1440", "appointment-reminder-off-\(id)"] {
            let button = UITestConditions.element(app, identifier)
            FormUITestConditions.reveal(button, in: app, scrollID: "appointments-scroll")
            XCTAssertTrue(button.exists && button.isHittable)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44)
            ReminderJourneyObservation.capture(app, name + "-" + identifier, testCase: testCase)
        }
    }

    static func inspectPreparation(_ app: XCUIApplication, name: String, testCase: XCTestCase) {
        for text in [clinic, note, "최근 증상 변화, 복용 정보와 확인할 기록을 준비해 주세요."] {
            guard let element = preparationContent(app, text: text, name: name, testCase: testCase) else { return }
            XCTAssertTrue(UITestConditions.exists(element))
            FormUITestConditions.reveal(element, in: app, scrollID: "navigation-route-scroll", towardTop: text == clinic)
            XCTAssertEqual(element.label, text)
            let scroll = UITestConditions.element(app, "navigation-route-scroll")
            let keyboard = app.keyboards.firstMatch
            let geometry = FormScrollGeometry(application: app.frame, scroll: scroll.frame, keyboard: keyboard.exists ? keyboard.frame : nil)
            XCTAssertTrue(geometry?.contains(element.frame) == true)
            XCTAssertTrue(element.isHittable)
            XCTAssertTrue(app.frame.insetBy(dx: 0, dy: 1).intersects(element.frame))
            ReminderJourneyObservation.capture(app, name + "-preparation-content", testCase: testCase)
        }
        XCTAssertTrue(UITestConditions.element(app, "appointment-preparation").exists)
    }

    /// A complete same-label, same-frame ancestor chain represents one rendered region; select its unique leaf.
    private static func preparationContent(_ app: XCUIApplication, text: String, name: String, testCase: XCTestCase) -> XCUIElement? {
        let route = UITestConditions.element(app, "appointment-preparation")
        let scroll = UITestConditions.element(app, "navigation-route-scroll")
        guard route.exists, scroll.exists else { XCTFail("The preparation route must exist before content enumeration"); return nil }
        let applicationFrame = app.frame
        let scrollFrame = scroll.frame
        let keyboard = app.keyboards.firstMatch
        let keyboardFrame = keyboard.exists ? keyboard.frame : nil
        let geometry = FormScrollGeometry(application: applicationFrame, scroll: scrollFrame, keyboard: keyboardFrame)
        let candidates = scroll.descendants(matching: .staticText).matching(NSPredicate(format: "label == %@", text)).allElementsBoundByIndex
        var records: [(element: XCUIElement, label: String, frame: CGRect, descendants: Int)] = []
        var observations = ["application=\(applicationFrame), scroll=\(scrollFrame), keyboard=\(String(describing: keyboardFrame)), viewport=\(String(describing: geometry?.viewport))"]
        for candidate in candidates {
            let frame = candidate.frame
            let hittable = candidate.isHittable
            let contained = geometry?.contains(frame) == true
            let label = candidate.label
            let descendants = candidate.descendants(matching: .staticText).matching(NSPredicate(format: "label == %@", text)).count
            records.append((candidate, label, frame, descendants))
            observations.append("label=\(label), identifier=\(candidate.identifier), type=\(candidate.elementType.rawValue), frame=\(frame), hittable=\(hittable), contained=\(contained), matchingDescendants=\(descendants)")
        }
        // Record the entire scoped hierarchy before reveal can issue any gesture, including an ambiguous result.
        XCTContext.runActivity(named: "Preparation content candidates before scrolling") { activity in
            let attachment = XCTAttachment(string: observations.joined(separator: "\n") + "\n" + scroll.debugDescription)
            attachment.name = name + "-preparation-candidates"
            attachment.lifetime = .keepAlways
            activity.add(attachment)
        }
        ReminderJourneyObservation.capture(app, name + "-before-preparation-scroll", testCase: testCase)
        // Counts 0...n-1 require one root containing every match and one successively nested child at each depth.
        // Separate branches, distinct text regions and multiple leaves cannot satisfy this complete-chain invariant.
        let sameRegion = records.allSatisfy { record in record.label == text && records.allSatisfy { $0.frame == record.frame } }
        let completeChain = records.map(\.descendants).sorted() == Array(0 ..< records.count)
        var leaves = records.filter { $0.descendants == 0 }.map(\.element)
        guard !records.isEmpty, sameRegion, completeChain, leaves.count == 1 else {
            XCTFail("Expected one same-frame preparation text chain; observed \(records.count), sameRegion=\(sameRegion), completeChain=\(completeChain), leaves=\(leaves.count)")
            return nil
        }
        return leaves.popLast()
    }
}
