import XCTest

/// The picker can expose Korean labels alongside English VoiceOver time units.
private enum DailyReminderWheelText {
    static func isHour(_ value: String) -> Bool {
        value.contains("시") || value.lowercased().contains("o’clock") || value.lowercased().contains("o'clock")
    }

    static func isMinute(_ value: String) -> Bool {
        value.contains("분") || value.lowercased().contains("minute")
    }

    /// XCTest selects numeric options even when the visible wheel value includes a localized unit.
    static func optionValue(for value: String, number: Int) throws -> String {
        let expression = try NSRegularExpression(pattern: "[0-9]+")
        let matches = expression.matches(in: value, range: NSRange(value.startIndex..., in: value))
        guard matches.count == 1 else {
            throw NSError(domain: "DailyReminderSetup", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unrecognized time wheel: \(value)"])
        }
        return String(number)
    }
}

/// Schedule through the real Settings UI, then observe the system banner and tap.
/// This requires a disposable installation and does not simulate delivery or permission.
@MainActor
final class DailyReminderDeliveryUITests: XCTestCase {
    func testScheduledDailyReminderOpensPreparationFromSystemBanner() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["OROT_DAILY_REMINDER_DELIVERY_TEST"] == "YES",
                          "Requires an allocated disposable installation")
        let mode = try XCTUnwrap(environment["OROT_DAILY_REMINDER_DELIVERY_MODE"])
        XCTAssertTrue(mode == "warm" || mode == "cold", "Choose the warm or cold process boundary")
        guard mode == "warm" || mode == "cold" else { return }

        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        // A previous reminder tap can restore this conversation; return home without resetting saved reminder state.
        let settingsTab = app.buttons.matching(identifier: "navigation-tab-settings").firstMatch
        let homeAction = app.buttons.matching(identifier: "navigation-home").firstMatch
        let navigationReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            settingsTab.exists || homeAction.exists
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [navigationReady]), .completed, app.debugDescription)
        if !settingsTab.exists {
            XCTAssertTrue(homeAction.exists && homeAction.isHittable, app.debugDescription)
            try NavigationUITestConditions.tapNavigation(app, "navigation-home")
        }
        let settingsAction = try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings")
        XCTAssertTrue(settingsAction.control.exists && settingsAction.control.isHittable, app.debugDescription)
        attach(app, name: "daily-reminder-home")
        try NavigationUITestConditions.openTab(app, "settings", markers: ["settings-title"])
        let status = UITestConditions.element(app, "settings-daily-reminder-status")
        UITestConditions.scrollTo(status, in: app.scrollViews.firstMatch)
        XCTAssertTrue(UITestConditions.exists(status), app.debugDescription)
        try scheduleReminder(app, status: status)
        attach(app, name: "daily-reminder-scheduled")

        if mode == "cold" {
            app.terminate()
        } else {
            XCUIDevice.shared.press(.home)
        }
        let background = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let state = app.state
            return mode == "cold" ? state == .notRunning : state == .runningBackground || state == .runningBackgroundSuspended
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [background]), .completed)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let banner = ReminderJourneyObservation.deliveredBanner(
            in: springboard,
            bodyText: "오늘의 기록을 확인해 보세요.",
        )
        let notification = banner.body
        // Wait for the actual delivered UI and its hit target; no clock change or injected tap is used.
        let delivered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            banner.container.exists && banner.container.isHittable && notification.exists &&
                notification.label == "오늘의 기록을 확인해 보세요." && notification.isHittable
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [delivered]), .completed)
        guard notification.exists, notification.isHittable else { return }
        let title = banner.title
        // The content-title node is scoped to the delivered banner, separate from the app icon name.
        let titleReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            title.exists && title.label == "오롯" && title.isHittable
        }, object: nil)
        let titleReadiness = XCTWaiter.wait(for: [titleReady], timeout: 5.0)
        XCTAssertEqual(titleReadiness, .completed, springboard.debugDescription)
        guard titleReadiness == .completed else { return }
        XCTAssertTrue(banner.appIcon.exists && banner.appIcon.label == "오롯", springboard.debugDescription)
        attach(springboard, name: "daily-reminder-system-banner")
        notification.tap()
        let foreground = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.state == .runningForeground }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [foreground]), .completed)
        // Reminder taps open the report task inside the AI conversation; its date is visible before explicit generation.
        let reportDate = UITestConditions.element(app, "daily-report-date")
        XCTAssertTrue(UITestConditions.exists(reportDate), app.debugDescription)
        attach(app, name: "daily-reminder-preparation")
    }

    /// Use observed localized picker values; unknown AX wheels fail rather than select a guessed control.
    private func scheduleReminder(_ app: XCUIApplication, status: XCUIElement) throws {
        let toggle = UITestConditions.element(app, "settings-daily-reminder-switch")
        UITestConditions.scrollTo(toggle, in: app.scrollViews.firstMatch)
        XCTAssertTrue(toggle.exists && toggle.isHittable, toggle.debugDescription)
        // Settings disables the switch until both saved preference and scheduler reads settle.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in toggle.isEnabled }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed, status.debugDescription)
        let toggleValue = try XCTUnwrap(toggle.value as? String)
        guard toggleValue == "0" || toggleValue == "1" else {
            throw NSError(domain: "DailyReminderSetup", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown reminder switch value: \(toggleValue)"])
        }
        if toggleValue == "0" {
            toggle.tap()
        } else {
            let time = UITestConditions.element(app, "settings-daily-reminder-time")
            UITestConditions.scrollTo(time, in: app.scrollViews.firstMatch)
            XCTAssertTrue(time.exists && time.isHittable, time.debugDescription)
            time.tap()
        }
        let picker = UITestConditions.element(app, "settings-daily-reminder-native-time-picker")
        XCTAssertTrue(UITestConditions.exists(picker), app.debugDescription)
        let wheels = picker.pickerWheels.allElementsBoundByIndex
        func onlyWheel(_ match: (String) -> Bool) throws -> XCUIElement {
            let matches = wheels.filter { wheel in
                guard let value = wheel.value as? String else { return false }
                return match(value)
            }
            guard matches.count == 1 else {
                throw NSError(domain: "DailyReminderSetup", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unrecognized time picker: \(picker.debugDescription)"])
            }
            return matches[0]
        }
        let period = try onlyWheel { $0.contains("오전") || $0.contains("오후") }
        let hour = try onlyWheel(DailyReminderWheelText.isHour)
        let minute = try onlyWheel(DailyReminderWheelText.isMinute)
        guard wheels.count == 3, period !== hour, period !== minute, hour !== minute else {
            throw NSError(domain: "DailyReminderSetup", code: 5, userInfo: [NSLocalizedDescriptionKey: "Time picker does not expose three distinct wheels: \(picker.debugDescription)"])
        }
        let target = Date().addingTimeInterval(180)
        let components = Calendar.current.dateComponents([.hour, .minute], from: target)
        let targetHour = try XCTUnwrap(components.hour)
        let targetMinute = try XCTUnwrap(components.minute)
        let periodValue = try XCTUnwrap(period.value as? String)
        let desiredPeriod = targetHour < 12 ? "오전" : "오후"
        let selectedPeriod = periodValue.replacingOccurrences(of: targetHour < 12 ? "오후" : "오전", with: desiredPeriod)
        if selectedPeriod != periodValue {
            period.adjust(toPickerWheelValue: selectedPeriod)
        }
        try adjust(hour, number: targetHour % 12 == 0 ? 12 : targetHour % 12)
        try adjust(minute, number: targetMinute)
        // If setting the wheel took too long, the next calendar occurrence may be tomorrow.
        let selectedMinute = try XCTUnwrap(Calendar.current.dateInterval(of: .minute, for: target)?.start)
        guard selectedMinute.timeIntervalSinceNow > 60 else {
            throw NSError(domain: "DailyReminderSetup", code: 3, userInfo: [NSLocalizedDescriptionKey: "Selected reminder time is no longer safely in the future"])
        }
        attach(app, name: "daily-reminder-time-picker")
        let save = UITestConditions.element(app, "settings-daily-reminder-save-time")
        XCTAssertTrue(save.exists && save.isHittable, save.debugDescription)
        save.tap()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let prompt = springboard.alerts.firstMatch
        let expected = String(format: "%02d:%02d", targetHour, targetMinute)
        let successText = "매일 \(expected) 알림을 예약했어요"
        func failed(_ text: String) -> Bool {
            text.contains("예약하지 못했어요") || text.contains("확인하지 못했어요")
        }
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let text = status.exists ? UITestConditions.text(status) : ""
            return prompt.exists || text.contains(successText) || failed(text)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [settled]), .completed)
        if prompt.exists {
            let promptText = prompt.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
            XCTAssertTrue(promptText.contains("알림") || promptText.localizedCaseInsensitiveContains("notification"), prompt.debugDescription)
            let allow = prompt.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "허용"])).firstMatch
            XCTAssertTrue(allow.exists && allow.isHittable, prompt.debugDescription)
            attach(springboard, name: "daily-reminder-notification-permission")
            allow.tap()
        }
        let scheduled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard status.exists else { return false }
            let text = UITestConditions.text(status)
            return text.contains(successText) || failed(text)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [scheduled]), .completed, status.debugDescription)
        XCTAssertTrue(UITestConditions.text(status).contains(successText), status.debugDescription)
    }

    /// Map the observed localized value to the numeric option accepted by XCTest.
    private func adjust(_ wheel: XCUIElement, number: Int) throws {
        let value = try XCTUnwrap(wheel.value as? String)
        try wheel.adjust(toPickerWheelValue: DailyReminderWheelText.optionValue(for: value, number: number))
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}
