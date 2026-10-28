import CoreFoundation
import XCTest

/// Types synthetic observations through the product UI and its real encrypted repository.
final class SymptomJournalUITests: OrotFailFastTestCase {
    private let singleSeverityObservation = ProcessInfo.processInfo.environment["OROT_SINGLE_SEVERITY_DRAG"] == "1"
    private let singleOnsetObservation = ProcessInfo.processInfo.environment["OROT_SINGLE_ONSET_REVEAL"] == "1"
    private var severityDragObserved = false
    private var severityGestureBeganAtMs: Double?
    private var severityGestureEndedAtMs: Double?

    @MainActor
    func testCreationEditingFilteringAndResolutionSurviveRelaunch() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        try launchJournal(app)
        guard tap(app, "symptom-add") else { return }
        SymptomJournalUITestObservations.assertFullContentFormLane(app)
        guard replace(app, "symptom-description", "Synthetic intermittent tingling", multiline: true) else { return }
        NavigationUITestConditions.symptomAccessorySnapshot(app, testCase: self, phase: "create-description-focused")
        if singleOnsetObservation {
            var observed = false
            FormUITestConditions.reveal(app.textFields["symptom-onset-date"], in: app, scroll: UITestConditions.element(app, "symptoms-scroll"), observeFirstDrag: { application, viewport, target, controls, start, end in
                SymptomJournalUITestObservations.onsetReveal(app, application: application, viewport: viewport, target: target, controls: controls, start: start, end: end)
                observed = true
            })
            XCTAssertTrue(observed, "The diagnostic must reach the first onset-date reveal drag")
            return
        }
        guard replace(app, "symptom-onset-date", "2025-04-02") else { return }
        guard replace(app, "symptom-onset-time", "09:30") else { return }
        guard tap(app, "symptom-status-active") else { return }
        if singleSeverityObservation {
            // Incomplete geometry cannot justify an input gesture; reject it before touching severity.
            print("Journal single severity diagnostic opt-in active")
            let prior = diagnosticSnapshot(app, phase: "delivery-before-severity")
            let delivery = prior?.last { event in
                event["event"] as? String == "symptom-scroll-diagnostic"
                    && ["layout", "content-size"].contains(event["phase"] as? String ?? "")
            }
            let requiredGeometry = ["contentOffset": ["x", "y"], "contentSize": ["width", "height"],
                                    "contentInset": ["top", "left", "bottom", "right"], "layoutMeasurement": ["width", "height"]]
            guard let atMs = delivery?["receivedAtMs"] as? Double, atMs.isFinite,
                  let payload = (delivery?["payload"] as? String)?.data(using: .utf8),
                  let geometry = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any],
                  let metrics = geometry["latestScrollEvent"] as? [String: Any],
                  requiredGeometry.allSatisfy({ name, keys in
                      guard let fields = metrics[name] as? [String: Any] else { return false }
                      return keys.allSatisfy {
                          guard let number = fields[$0] as? NSNumber else { return false }
                          return CFGetTypeID(number) != CFBooleanGetTypeID() && number.doubleValue.isFinite
                      }
                  })
            else {
                XCTFail("Severity diagnostic requires a delivered layout/content-size event with a finite receipt time and complete finite contentOffset, contentSize, contentInset and layoutMeasurement")
                return
            }
        }
        let severityCompleted = replace(app, "symptom-severity", "6", observeFocusGesture: true)
        // A diagnostic completion proves only that one original focused drag was measured, never journal acceptance.
        if singleSeverityObservation {
            XCTAssertTrue(severityDragObserved, "The setup must reach the first focused severity drag")
            return
        }
        // A failed edit already recorded an assertion; never wait for a keyboard action after that failure.
        guard severityCompleted else { return }
        accessory(app, "symptom-keyboard-save-severity")
        guard visible(app, "Synthetic intermittent tingling") else { return }
        guard visible(app, "내가 느낀 불편 정도: 6/10") else { return }
        guard visible(app, "직접 입력한 기록이며 의료진이 확인한 정보는 아니에요.") else { return }
        let description = app.staticTexts.matching(NSPredicate(format:
            "identifier BEGINSWITH 'symptom-' AND identifier ENDSWITH '-description'")).firstMatch
        let cardID = String(description.identifier.dropLast("-description".count))
        // Remove only the card's wrapper; the stored entry ID retains its own symptom- prefix.
        let entryID = String(cardID.dropFirst("symptom-".count))
        XCTAssertTrue(description.exists && description.isHittable && UITestConditions.element(app, "symptom-select-" + entryID).label == "증상 기록 선택: Synthetic intermittent tingling")
        // The selected summary is local to this existing journal route.
        guard tap(app, "symptom-select-" + entryID) else { return }
        UITestConditions.value(
            UITestConditions.element(app, "symptoms-selected-description"),
            equals: "Synthetic intermittent tingling",
        )
        let onset = UITestConditions.element(app, cardID + "-onset")
        XCTAssertTrue(onset.exists)
        let originalOnset = UITestConditions.text(onset)
        XCTAssertTrue(originalOnset.contains("2025년 4월 2일") && originalOnset.contains("09:30") && originalOnset.contains("현지 시각"))
        guard tap(app, "symptom-edit-" + entryID) else { return }
        SymptomJournalUITestObservations.assertFullContentFormLane(app)
        guard replace(app, "symptom-description", "Synthetic tingling after lunch\nUsually in the afternoon", multiline: true, observeCursorTap: true) else { return }
        NavigationUITestConditions.symptomAccessorySnapshot(app, testCase: self, phase: "before-edit-accessory-wait")
        accessory(app, "symptom-keyboard-save-description")
        UITestConditions.value(UITestConditions.element(app, cardID + "-description"),
                               equals: "Synthetic tingling after lunch\nUsually in the afternoon")
        UITestConditions.value(UITestConditions.element(app, cardID + "-onset"), equals: originalOnset)
        guard tap(app, "symptom-filter-active", towardTop: true) else { return }
        guard replace(app, "symptom-filter-from-date", "2025-04-02") else { return }
        guard replace(app, "symptom-filter-from-time", "09:30") else { return }
        guard replace(app, "symptom-filter-through-date", "2025-04-02") else { return }
        guard replace(app, "symptom-filter-through-time", "09:30") else { return }
        accessory(app, "symptom-filter-keyboard-apply-through-time")
        UITestConditions.value(UITestConditions.element(app, cardID + "-status"), equals: "계속되고 있어요")
        guard tap(app, "symptom-resolve-" + entryID) else { return }
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "symptoms-empty")))
        guard tap(app, "symptom-filter-resolved", towardTop: true) else { return }
        UITestConditions.value(UITestConditions.element(app, cardID + "-status"), equals: "나아졌어요")
        UITestConditions.value(UITestConditions.element(app, cardID + "-onset"), equals: originalOnset)
        capture(app, "symptom-journal-resolved")
        app.terminate()
        try launchJournal(app)
        UITestConditions.value(UITestConditions.element(app, cardID + "-status"), equals: "나아졌어요")
        UITestConditions.value(UITestConditions.element(app, cardID + "-onset"), equals: originalOnset)
        guard visible(app, "직접 입력한 기록이며 의료진이 확인한 정보는 아니에요.") else { return }
        capture(app, "symptom-journal-persisted-after-relaunch")
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        NavigationUITestConditions.route(app, markers: ["records-title"])
    }

    @MainActor
    private func launchJournal(_ app: XCUIApplication) throws {
        // English device settings exercise the Korean-only copy through the real journal route.
        app.launchArguments = ["-OROT_TEST_PROFILE", "core", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        // The passive marker is opted in for this scenario; diagnostic-only early-exit flags remain separate.
        app.launchArguments += ["-OROT_TEST_NAVIGATION_OBSERVATION", "YES"]
        app.launch()
        NavigationUITestConditions.route(app, markers: ["welcome-title"])
        try NavigationUITestConditions.openTab(app, "records", markers: ["records-title"])
        let open = UITestConditions.element(app, "symptoms-open")
        XCTAssertTrue(UITestConditions.exists(open))
        FormUITestConditions.reveal(open, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(open.isHittable)
        open.tap()
        NavigationUITestConditions.route(app, markers: ["symptoms-title"])
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "symptoms-title")) && UITestConditions.element(app, "symptoms-title").label == "증상 일지" && !UITestConditions.element(app, "symptoms-back").exists)
    }

    @MainActor
    private func replace(_ app: XCUIApplication, _ identifier: String, _ value: String, multiline: Bool = false, observeCursorTap: Bool = false, observeFocusGesture: Bool = false) -> Bool {
        let input = multiline ? app.textViews[identifier] : app.textFields[identifier]
        XCTAssertTrue(UITestConditions.exists(input))
        return FormUITestConditions.replace(input, with: value, in: app, scrollID: "symptoms-scroll", observeCursorTap: observeCursorTap ? { phase in
            SymptomJournalUITestObservations.cursorTap(app, input: input, phase: phase)
        } : nil, observeFocusGesture: SymptomJournalUITestObservations.onsetFocusObserver(app, input: input, identifier: identifier, forwarding: observeFocusGesture ? { phase, reservation in
            self.observeJournalFocusGesture(app, input: input, phase: phase, reservation: reservation)
            if phase == "single-observation-complete" {
                self.severityDragObserved = true
            }
        } : nil), stopAfterFirstFocusDrag: singleSeverityObservation && observeFocusGesture)
    }

    /// AX reads are sequential observations around the unchanged severity gestures, not an atomic layout snapshot.
    @MainActor
    private func observeJournalFocusGesture(_ app: XCUIApplication, input: XCUIElement, phase: String, reservation: CGRect?) {
        let scroll = UITestConditions.element(app, "symptoms-scroll")
        let keyboard = app.keyboards.firstMatch
        let applicationFrame = app.frame
        let scrollFrame = scroll.frame
        let keyboardFrame = keyboard.exists ? keyboard.frame : nil
        let inputFrame = input.exists ? input.frame : nil
        let actual = FormScrollGeometry(application: applicationFrame, scroll: scrollFrame, keyboard: keyboardFrame)
        let effective = FormScrollGeometry(application: applicationFrame, scroll: scrollFrame, keyboard: keyboardFrame, reservedKeyboard: reservation)
        let focused = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND hasKeyboardFocus == true", input.identifier)).count > 0
        let bar = UITestConditions.element(app, "navigation-action-bar-overlay")
        let barFrame = bar.exists ? bar.frame : nil
        // This observer reads AX state without a UIKit contentOffset bridge; do not relabel an AX value or relative frame as that offset.
        let observations = [
            "application=\(applicationFrame), scroll=\(scrollFrame)",
            "keyboard=\(String(describing: keyboardFrame)), reservedKeyboard=\(String(describing: reservation))",
            "keyboardViewport=\(String(describing: actual?.viewport)), keyboardReservationViewport=\(String(describing: effective?.viewport))",
            "input=\(String(describing: inputFrame)), focused=\(focused), hittable=\(input.exists && input.isHittable)",
            "scrollAXValue=\(String(describing: scroll.value)), contentOffset=not-observed",
            "inputYWithinScroll=\(String(describing: inputFrame.map { $0.minY - scrollFrame.minY }))",
            "navigationBar=\(String(describing: barFrame))",
            "alerts=\(app.alerts.allElementsBoundByIndex.map(\.label))",
        ].joined(separator: "; ")
        XCTContext.runActivity(named: "Journal severity focus \(phase): \(observations)") { _ in }
        if singleSeverityObservation {
            // These are contemporaneous public AX observations; absent tabs remain unavailable rather than inferred from setup.
            let selected = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'navigation-tab-'")).allElementsBoundByIndex.filter(\.isSelected).map(\.identifier)
            print("Journal diagnostic route symptomsVisible=\(UITestConditions.element(app, "symptoms-title").exists), selectedTab=\(selected.isEmpty ? "unavailable" : selected.joined(separator: ","))")
            // Host observation boundaries bracket the gesture call; they are not native touch timestamps.
            if phase == "after-scroll-1" {
                severityGestureEndedAtMs = Date().timeIntervalSince1970 * 1000
            }
            _ = diagnosticSnapshot(app, phase: phase)
            if phase == "before-scroll-1" {
                severityGestureBeganAtMs = Date().timeIntervalSince1970 * 1000
            }
        }
    }

    /// Interpret the helper's single raw snapshot without repairing missing, truncated or stale observations.
    @MainActor
    private func diagnosticSnapshot(_ app: XCUIApplication, phase: String) -> [[String: Any]]? {
        guard let snapshot = NavigationUITestConditions.observationSnapshot(app, testCase: self, attachmentName: "severity-\(phase)-native-navigation"),
              let lifecycle = snapshot["lifecycle"] as? [[String: Any]]
        else {
            print("Journal native snapshot \(phase): unavailable or truncated")
            return nil
        }
        let events = lifecycle.filter { $0["event"] as? String == "symptom-scroll-diagnostic" }
        let trace = snapshot["symptomScrollTrace"] as? [String: Any] ?? [:]
        print("Journal native snapshot \(phase): atMs=\(String(describing: snapshot["atMs"])), ringCount=\(lifecycle.count), selection=\(String(describing: trace["selection"])), nativeRecorded=\(String(describing: trace["recordedCount"])), nativeDropped=\(String(describing: trace["droppedCount"])), hostStartBoundaryMs=\(String(describing: severityGestureBeganAtMs)), hostEndBoundaryMs=\(String(describing: severityGestureEndedAtMs))")
        if phase == "single-observation-complete" {
            XCTAssertEqual((trace["selection"] as? [String: Any])?["attached"] as? Bool, true, "The symptom UIScrollView trace must actually attach")
            XCTAssertTrue((trace["events"] as? [[String: Any]])?.contains {
                $0["event"] as? String == "symptom-native-scroll-pan" && $0["isScrollPan"] as? Bool == true && $0["ownerIsScrollView"] as? Bool == true
                    && (($0["callbackAtMs"] as? Double) ?? -.infinity) >= (severityGestureBeganAtMs ?? .infinity)
            } == true, "The existing scroll pan must deliver a callback after this severity gesture began")
        }
        return events
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ identifier: String, towardTop: Bool = false) -> Bool {
        let target = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(target))
        let revealed = FormUITestConditions.reveal(target, in: app, scrollID: "symptoms-scroll", towardTop: towardTop) != nil
        let hittable = target.isHittable
        XCTAssertTrue(hittable)
        guard revealed, hittable else { return false }
        target.tap()
        return true
    }

    @MainActor
    private func accessory(_ app: XCUIApplication, _ identifier: String) {
        let button = UITestConditions.element(app, identifier)
        XCTAssertTrue(UITestConditions.exists(button) && button.isHittable)
        button.tap()
    }

    @MainActor
    private func visible(_ app: XCUIApplication, _ text: String) -> Bool {
        let target = app.staticTexts.matching(NSPredicate(format: "label == %@", text)).firstMatch
        XCTAssertTrue(UITestConditions.exists(target))
        let revealed = FormUITestConditions.reveal(target, in: app, scrollID: "symptoms-scroll", towardTop: true) != nil
        let hittable = target.isHittable
        XCTAssertTrue(hittable)
        guard revealed, hittable else { return false }
        return true
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
