import XCTest

/// Exercises the OS lifecycle without relaunching the app or replacing its retained route.
@MainActor
enum NavigationForegroundUITestConditions {
    /// Fresh owned fixtures must finish the real appearance gate before the retained-route journey.
    /// This neutral selection uses the production save action; it grants no model or data permission.
    static func prepareFreshAppearance(_ app: XCUIApplication) {
        let star = UITestConditions.element(app, "별")
        XCTAssertTrue(UITestConditions.exists(star), app.debugDescription)
        XCTAssertTrue(star.isHittable)
        star.tap()
        let save = app.buttons["assistant-appearance-save"]
        guard FormUITestConditions.reveal(save, in: app, scrollID: "assistant-appearance-scroll") != nil else { return }
        XCTAssertTrue(save.isHittable && save.isEnabled)
        save.tap()
    }

    /// Avoid XCTest's invalid child scroll hit point while preserving actual native action geometry.
    static func tapVisibleCitation(_ app: XCUIApplication, citation: XCUIElement, testCase: XCTestCase) {
        XCTAssertTrue(citation.exists && citation.isEnabled && citation.isHittable)
        let frame = citation.frame, window = app.frame
        let history = UITestConditions.element(app, "rag-conversation-history")
        XCTAssertTrue(history.exists)
        let viewport = history.frame
        let input = UITestConditions.element(app, "rag-conversation-input").frame
        let keyboard = app.keyboards.firstMatch
        let keyboardFrame = keyboard.exists ? keyboard.frame : .null
        let attachment = XCTAttachment(string: "citation=\(frame), window=\(window), history=\(viewport), input=\(input), keyboard=\(keyboardFrame)")
        attachment.name = "citation-native-hit-frames"
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
        XCTAssertTrue([frame.minX, frame.minY, frame.width, frame.height].allSatisfy(\.isFinite))
        XCTAssertGreaterThanOrEqual(frame.width, 44)
        XCTAssertGreaterThanOrEqual(frame.height, 44)
        XCTAssertTrue(window.contains(frame) && viewport.contains(frame))
        XCTAssertFalse(frame.intersects(input) || frame.intersects(keyboardFrame))
        let offset = CGVector(dx: frame.midX - window.minX, dy: frame.midY - window.minY)
        app.coordinate(withNormalizedOffset: .zero).withOffset(offset).tap()
    }

    static func restoreEditableDraft(_ app: XCUIApplication, draft: String, citation: XCUIElement) throws {
        let input = UITestConditions.element(app, "rag-conversation-input")
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(citation.exists)
        XCUIDevice.shared.press(.home)
        let background = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [background], timeout: 10), .completed,
                       "The app must actually enter the background")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        let editable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            input.exists && input.isHittable && (input.value as? String) == draft && citation.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [editable], timeout: 15), .completed,
                       "Foreground return must expose the retained content and editor, not a blocking veil")
        // A real edit detects an invisible input-blocking overlay; do not dispatch another request.
        input.tap()
        input.typeText("!")
        XCTAssertEqual(input.value as? String, draft + "!")
        input.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(citation.exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "retained-content-after-foreground"
        attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: "Foreground retained draft and visible content") { $0.add(attachment) }
        // Compare final navigation with the original keyboard-free root after proving real editing.
        // A real prose tap uses the history scroll view's normal unhandled-tap dismissal, not a test API.
        let prose = app.staticTexts["rag-conversation-answer-body"]
        XCTAssertTrue(prose.exists && prose.isHittable)
        prose.tap()
        let keyboardHidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !app.keyboards.firstMatch.exists
                && UITestConditions.element(app, "ai-feature-visit-questions-keyboard-hidden").exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardHidden], timeout: 10), .completed,
                       "Native keyboard and fixture keyboard event must agree before root geometry comparison")
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(citation.exists)
    }

    /// Verify the same restored answer and unsent native draft without testing card overlap.
    static func verifySyntheticLifecycle(
        _ app: XCUIApplication, history: XCUIElement, answer: XCUIElement, session: String,
        phase: String, testCase: XCTestCase,
    ) throws {
        defer {
            if phase == "resize" {
                NavigationRotationUITestConditions.attachSyntheticScrollTrace(app, testCase: testCase, name: "after")
            }
        }
        let input = UITestConditions.element(app, "rag-conversation-input")
        let keyboard = app.keyboards.firstMatch
        let label = answer.label
        func unobscuredCenter(_ element: XCUIElement, inside region: CGRect) -> CGPoint? {
            guard element.exists, element.isHittable else { return nil }
            let frame = element.frame
            let center = CGPoint(x: frame.midX, y: frame.midY)
            guard frame.width > 0, frame.height > 0, region.contains(center), app.frame.contains(center),
                  !keyboard.exists || !keyboard.frame.contains(center) else { return nil }
            return center
        }
        func answerPoint() -> CGPoint? {
            guard history.exists, answer.exists, answer.label == label else { return nil }
            return unobscuredCenter(answer, inside: history.frame)
        }
        func inputIsReady() -> Bool {
            unobscuredCenter(input, inside: app.frame) != nil && input.isEnabled
        }
        let initialReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            answerPoint() != nil && inputIsReady() && !keyboard.exists
        }, object: nil)
        let initialSettled = XCTWaiter.wait(for: [initialReady], timeout: 15) == .completed
        guard initialSettled, answerPoint() != nil, inputIsReady(), !keyboard.exists else {
            XCTFail("The fresh synthetic answer and editor must be unobscured")
            return
        }
        let initial = input.value as? String
        guard initial == nil || initial == "" || initial == input.placeholderValue else {
            XCTFail("Only a fresh synthetic field may be edited")
            return
        }
        let draft = "synthetic lifecycle draft"
        input.tap()
        input.typeText(draft)
        guard input.value as? String == draft else {
            XCTFail("Could not seed the unsent synthetic draft")
            return
        }
        if keyboard.exists {
            // The keyboard can shift the transcript. Never tap stale, clipped, or covered text.
            let dismissible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !keyboard.exists || answerPoint() != nil
            }, object: nil)
            guard XCTWaiter.wait(for: [dismissible], timeout: 10) == .completed else {
                XCTFail("No unobscured synthetic answer became available to dismiss the keyboard")
                return
            }
            if keyboard.exists {
                guard let point = answerPoint() else {
                    XCTFail("The synthetic answer became obscured before the dismiss tap")
                    return
                }
                let frame = app.frame
                app.coordinate(withNormalizedOffset: .zero)
                    .withOffset(CGVector(dx: point.x - frame.minX, dy: point.y - frame.minY)).tap()
            }
            let keyboardHidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !keyboard.exists
            }, object: nil)
            guard XCTWaiter.wait(for: [keyboardHidden], timeout: 10) == .completed else {
                XCTFail("The native keyboard did not dismiss before the lifecycle boundary")
                return
            }
        }
        guard answerPoint() != nil, inputIsReady(), !keyboard.exists, input.value as? String == draft else {
            XCTFail("The same answer and unsent editor must be ready before the lifecycle boundary")
            return
        }
        var baseline: NavigationRotationUITestConditions.ScrollTrace? = nil
        if phase == "resize" {
            baseline = try XCTUnwrap(
                NavigationRotationUITestConditions.attachSyntheticScrollTrace(app, testCase: testCase, name: "before"),
                "The synthetic transcript scroll trace must be present before tapping the rotation probe",
            )
            let beforeWidth = history.frame.width
            _ = try NavigationRotationUITestConditions.rotateObservedScene(app, session: session, landscape: true, scrollID: "rag-conversation-history", syntheticProtectedContent: [answer, input])
            XCTAssertGreaterThan(abs(history.frame.width - beforeWidth), 0.5, "The transcript must actually resize")
        } else {
            let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
            settings.launch()
            let suspended = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                settings.state == .runningForeground && (app.state == .runningBackground || app.state == .runningBackgroundSuspended)
            }, object: nil)
            guard XCTWaiter.wait(for: [suspended], timeout: 10) == .completed else {
                XCTFail("Settings did not reach the OS foreground with Orot in the OS background")
                return
            }
            app.activate()
            guard app.wait(for: .runningForeground, timeout: 10) else {
                XCTFail("The app did not return to the OS foreground")
                return
            }
        }
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            answerPoint() != nil && inputIsReady() && (input.value as? String) == draft
        }, object: nil)
        let settled = XCTWaiter.wait(for: [ready], timeout: 15) == .completed
        if let baseline {
            let readinessAtMs = Date().timeIntervalSince1970 * 1000
            try verifySyntheticScrollTrace(app, from: baseline, after: readinessAtMs, testCase: testCase)
        }
        guard settled, answerPoint() != nil, inputIsReady(), input.value as? String == draft else {
            // OrotFailFastTestCase may terminate at XCTFail before the Swift defer runs.
            if phase == "resize" {
                NavigationRotationUITestConditions.attachSyntheticScrollTrace(app, testCase: testCase, name: "readiness-failed")
            }
            XCTFail("The same restored answer and unsent editor must be usable after the native boundary")
            return
        }
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "synthetic-conversation-\(phase)-retained"
        evidence.lifetime = .keepAlways
        testCase.add(evidence)
        // A native tap can put the caret anywhere; only one insertion and its real deletion are allowed.
        input.tap()
        input.typeText("!")
        let edited = try XCTUnwrap(input.value as? String)
        XCTAssertEqual(edited.filter { $0 == "!" }.count, 1)
        XCTAssertEqual(edited.filter { $0 != "!" }, draft)
        input.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertTrue(answer.exists && answer.label == label)
    }

    /// Poll for the first bridge envelope that actually starts after readiness; cached labels are not evidence.
    private static func verifySyntheticScrollTrace(
        _ app: XCUIApplication, from baseline: NavigationRotationUITestConditions.ScrollTrace,
        after readiness: Double, testCase: XCTestCase,
    ) throws {
        var sampled: NavigationRotationUITestConditions.ScrollTrace?
        let fresh = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let trace = NavigationRotationUITestConditions.readSyntheticScrollTrace(app), trace.startedAtMs >= readiness else { return false }
            sampled = trace
            return true
        }, object: nil)
        let result = XCTWaiter.wait(for: [fresh], timeout: 5)
        let trace = NavigationRotationUITestConditions.attachSyntheticScrollTrace(app, testCase: testCase, name: "after-readiness", trace: sampled)
        guard result == .completed, let trace, trace.observer == baseline.observer,
              let order = (baseline.events.last?["order"] as? String).flatMap(Int.init), order > 0, order <= Int.max - trace.events.count,
              let index = trace.events.firstIndex(where: { ($0["order"] as? String).flatMap(Int.init) == order }),
              trace.events.count > index + 1
        else {
            throw NSError(domain: "SyntheticScrollTraceUnavailable", code: 1)
        }
        for (offset, event) in trace.events[index...].enumerated() {
            guard let actual = (event["order"] as? String).flatMap(Int.init), actual == order + offset,
                  let boundary = event["boundary"] as? String, !boundary.isEmpty
            else {
                throw NSError(domain: "SyntheticScrollTraceDiscontinuous", code: 1)
            }
            if offset > 0, boundary == "status-bar-top-completed" {
                throw NSError(domain: "SyntheticRotationProbeTriggeredStatusBar", code: 1)
            }
        }
    }
}
