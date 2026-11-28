import XCTest

@MainActor
enum RecordingFixtureUITestConditions {
    /// The standalone fixture keeps saved rows in the review scroller, not the non-scrolling capture frame.
    /// Select only the disposable synthetic source; the verified host removes this independent case's app container after success or failure.
    static func select(_ app: XCUIApplication, testCase: XCTestCase) throws -> XCUIElement {
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Synthetic transcription test recording")).firstMatch
        FormUITestConditions.reveal(row, in: app, scrollID: "recording-review-scroll")
        let prefix = "recording-details-"
        XCTAssertTrue(row.identifier.hasPrefix(prefix), row.debugDescription)
        let source = String(row.identifier.dropFirst(prefix.count))
        XCTAssertNotNil(UUID(uuidString: source))
        testCase.addTeardownBlock { @MainActor in
            app.terminate()
        }
        return row
    }

    static func launch(_ app: XCUIApplication, playback: String? = nil, extra: [String] = []) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "speech", "-OROT_TRANSCRIPTION_PROBE_MODE", "recording-library-visual", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        if let playback {
            app.launchArguments += ["-OROT_RECORDING_PLAYBACK_PROBE", playback]
        }
        app.launch()
    }

    /// Read-only stages before editor activation can omit the global keyboard snapshot while retaining measured scrolling.
    static func reveal(_ app: XCUIApplication, _ identifier: String, towardTop: Bool = false, maximumScrollFraction: CGFloat = 0.45, keyboardMayBeVisible: Bool = true) -> XCUIElement {
        let target = UITestConditions.element(app, identifier)
        FormUITestConditions.reveal(target, in: app, scrollID: "recording-review-scroll", towardTop: towardTop, maximumScrollFraction: maximumScrollFraction, keyboardMayBeVisible: keyboardMayBeVisible)
        return target
    }

    static func capture(_ app: XCUIApplication, _ name: String, testCase: XCTestCase) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    /// Recording starts disabled until consent; reveal each control in its measured viewport before checking reachability.
    static func prepareRecordingAction(_ app: XCUIApplication, microphone: XCUIElement) {
        let scrollID = "recording-controls-scroll"
        XCTAssertTrue(microphone.exists)
        XCTAssertFalse(microphone.isEnabled, "Recording requires explicit consent")
        let consent = UITestConditions.element(app, "recording-consent")
        FormUITestConditions.reveal(consent, in: app, scrollID: scrollID, keyboardMayBeVisible: false)
        consent.tap()
        XCTAssertEqual(UITestConditions.text(UITestConditions.element(app, "recording-consent-status")), "동의 확인됨")
        XCTAssertTrue(microphone.isEnabled)
        FormUITestConditions.reveal(microphone, in: app, scrollID: scrollID, towardTop: true, keyboardMayBeVisible: false)
    }

    /// Prove the visible title and whole-section disclosure before editing any segment.
    static func openSavedTranscript(_ app: XCUIApplication) -> Bool {
        let title = app.staticTexts["recording-detail-title"]
        guard title.waitForExistence(timeout: 8), !title.frame.isEmpty, app.frame.intersects(title.frame) else {
            XCTFail("Saved recording title is not visible")
            return false
        }
        XCTAssertFalse(UITestConditions.text(title).isEmpty)
        // Only the removed inline actions are absent. The separate sidebar menu has its own scope.
        XCTAssertFalse(app.buttons["recording-export-audio"].exists)
        XCTAssertFalse(app.buttons["recording-export-transcript"].exists)
        let disclosure = app.buttons["recording-detail-transcript-toggle"]
        guard disclosure.waitForExistence(timeout: 8) else {
            XCTFail("Saved transcript disclosure is missing")
            return false
        }
        FormUITestConditions.reveal(disclosure, in: app, scrollID: "navigation-route-scroll")
        XCTAssertTrue(disclosure.isHittable)
        XCTAssertFalse(UITestConditions.element(app, "transcript-edit-0").exists)
        disclosure.tap()
        guard UITestConditions.element(app, "transcript-edit-0").waitForExistence(timeout: 8) else {
            XCTFail("The saved transcript did not expose its editor action")
            return false
        }
        XCTAssertFalse(UITestConditions.element(app, "transcript-segment-toggle-0").exists)
        return true
    }

    /// The encounter fixture starts with an actual native tool modal.
    static func setReviewTools(_ app: XCUIApplication, open: Bool) {
        let modal = UITestConditions.element(app, "encounter-probe-close")
        if modal.exists == open {
            return
        }
        let button = UITestConditions.element(app, open ? "encounter-probe-tools" : "encounter-probe-close")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            button.exists && button.isEnabled && button.isHittable && app.frame.contains(button.frame)
        }, object: button)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        button.tap()
        let state = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == %@", NSNumber(value: open)), object: modal)
        XCTAssertEqual(UITestConditions.wait(for: [state]), .completed)
    }

    struct ReviewLayout {
        let window: CGRect
        let scroll: CGRect
        let primary: CGRect
        let secondary: CGRect
    }

    /// Bind the active transcript editor to one route scroller before reading either panel.
    static func reviewLayout(_ app: XCUIApplication) -> ReviewLayout? {
        let scrollID = "navigation-route-scroll"
        let editorID = "transcript-input-0"
        let scroll = app.descendants(matching: .any).matching(identifier: scrollID)
        let editor = app.textViews.matching(identifier: editorID)
        guard scroll.firstMatch.exists, editor.count == 1,
              let owner = FormWindowOwnership.resolve(app, scroll: scroll.firstMatch, target: editor.firstMatch, reportFailure: false)
        else { return nil }
        let ownedScroll = owner.descendants(matching: .any).matching(identifier: scrollID)
        let primary = owner.descendants(matching: .any).matching(identifier: "recording-review-layout-primary")
        let secondary = owner.descendants(matching: .any).matching(identifier: "recording-review-layout-secondary")
        guard ownedScroll.count == 1, primary.count == 1, secondary.count == 1 else { return nil }
        let layout = ReviewLayout(window: owner.frame, scroll: ownedScroll.firstMatch.frame, primary: primary.firstMatch.frame, secondary: secondary.firstMatch.frame)
        guard layout.window.intersects(layout.scroll), layout.primary.width > 0, layout.secondary.width > 0 else { return nil }
        return layout
    }

    /// Width alone may describe a system AX window. Require the same route markers and panel axis in a fresh sample.
    static func reviewReflow(_ app: XCUIApplication, from initial: ReviewLayout, expanded: Bool, testCase: XCTestCase) -> ReviewLayout? {
        var last: ReviewLayout?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            last = reviewLayout(app)
            guard let layout = last,
                  abs(layout.window.width - initial.window.width) > 0.5,
                  !layout.primary.intersects(layout.secondary)
            else { return false }
            return expanded
                ? layout.window.width > layout.window.height && layout.primary.maxX <= layout.secondary.minX
                : layout.window.height > layout.window.width && layout.primary.maxY <= layout.secondary.minY
        }, object: nil)
        let settled = XCTWaiter.wait(for: [ready], timeout: 20) == .completed
        let dimensions = "requestedExpanded=\(expanded), before=\(initial), last=\(String(describing: last))"
        let receipt = XCTAttachment(string: dimensions)
        receipt.name = expanded ? "saved-recording-reflow-landscape" : "saved-recording-reflow-portrait"
        receipt.lifetime = .keepAlways
        testCase.add(receipt)
        guard settled else {
            XCTFail("The unique saved recording route did not reflow: \(dimensions)")
            return nil
        }
        return last
    }
}
