import XCTest

extension AppointmentsUITests {
    /// Geometry from the real route's UIKit owner. Insets do not prove painted scrollbar pixels.
    @MainActor
    func testAppAppointmentOuterEdgeKeepsScrollAndRailBack() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        let rotationSession = UUID().uuidString
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core", "-OROT_E2E_PROBE", "medical-appointment-app-navigation",
            "-OROT_TEST_APPOINTMENT_EDGE_SCROLL", "YES", "-OROT_TEST_NAVIGATION_OBSERVATION", "YES",
            "-OROT_TEST_NAVIGATION_FOCUS_OBSERVATION", "YES",
            "-OROT_TEST_ROTATION_GEOMETRY_SESSION", rotationSession, "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        defer {
            UITestConditions.terminateStandaloneApp(app)
            XCUIDevice.shared.orientation = .portrait
        }
        app.launch()
        do {
            try openAppointmentEdgeFixture(app)
        } catch {
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "appointment-edge-startup-failure"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            throw error
        }

        let compact = try proveAppointmentEdgeDrag(app, stage: "portrait")
        try UITestConditions.rotateAppointmentScene(app, session: rotationSession, landscape: true)
        let selected = app.buttons["appointment-select-synthetic-edge-appointment-0"]
        XCTAssertTrue(selected.exists && selected.isSelected, "Real size change must preserve the same appointment selection")
        let expanded = try proveAppointmentEdgeDrag(app, stage: "landscape")
        XCTAssertNotEqual(compact, expanded, "The viewport must actually reflow")
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        XCTAssertGreaterThan(back.toolbar.frame.height, back.toolbar.frame.width, "On expanded Duo, exercise a real right-rail Back")
        XCTAssertTrue(back.control.isEnabled && back.control.isHittable)
        try NavigationUITestConditions.tapNavigation(app, "navigation-back")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "calendar-title")))
    }

    /// Fresh App startup requires an appearance choice, and Schedule is a Records section.
    /// Stop at the exact missing stage rather than polling indefinitely before geometry.
    @MainActor
    private func openAppointmentEdgeFixture(_ app: XCUIApplication) throws {
        let element = { id in UITestConditions.element(app, id) }
        let starMatches = app.descendants(matching: .any).matching(identifier: "assistant-appearance-avatar-star")
        let star = starMatches.firstMatch
        try appointmentEdgeStartupReady(star, stage: "choose-appearance")
        guard starMatches.count == 1 else { throw appointmentEdgeStartupFailure(stage: "unique-star") }
        try appointmentEdgeStartupTap(star, stage: "choose-appearance")
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated {
                // Fabric iOS reports radio checked as AX value rather than selected trait.
                let checked = (star.value as? String)?.split(separator: ",").contains { $0.trimmingCharacters(in: .whitespaces) == "checked" } == true
                return checked || app.staticTexts["별 선택됨"].exists
            }
        }, object: nil)
        guard XCTWaiter.wait(for: [selected], timeout: 5) == .completed else {
            throw appointmentEdgeStartupFailure(stage: "star-selected")
        }
        print("OROT_APPOINTMENT_EDGE_STARTUP reached=star-selected")
        let appearanceScroll = element("assistant-appearance-scroll")
        let saveMatches = app.buttons.matching(identifier: "assistant-appearance-save")
        let save = saveMatches.firstMatch
        try appointmentEdgeStartupReady(appearanceScroll, stage: "appearance-scroll")
        try appointmentEdgeStartupReady(save, stage: "appearance-save-before-reveal")
        guard saveMatches.count == 1 else { throw appointmentEdgeStartupFailure(stage: "unique-appearance-save") }
        // The real folded viewport puts Save below the privacy copy until the form scrolls.
        guard FormUITestConditions.reveal(save, in: app, scroll: appearanceScroll, keyboardMayBeVisible: false) != nil else {
            throw appointmentEdgeStartupFailure(stage: "appearance-save-reveal")
        }
        guard saveMatches.count == 1 else { throw appointmentEdgeStartupFailure(stage: "unique-revealed-save") }
        try appointmentEdgeStartupTap(save, stage: "save-appearance")
        try appointmentEdgeStartupReady(element("rag-conversation-screen"), stage: "conversation")
        try appointmentEdgeStartupTap(app.buttons["navigation-tab-records"], stage: "records-tab")
        try appointmentEdgeStartupReady(element("records-title"), stage: "records")
        let schedule = element("records-open-schedule")
        _ = try XCTUnwrap(FormUITestConditions.reveal(schedule, in: app, scrollID: "navigation-route-scroll"))
        try appointmentEdgeStartupTap(schedule, stage: "schedule-section")
        try appointmentEdgeStartupReady(element("calendar-title"), stage: "schedule")
        try appointmentEdgeStartupReady(element("calendar-screen"), stage: "schedule-scroll")
        let manage = element("schedule-open-appointments")
        if !manage.exists || !manage.isHittable {
            _ = try XCTUnwrap(FormUITestConditions.reveal(manage, in: app, scrollID: "calendar-screen"), "Expose Manage Appointments")
        }
        try appointmentEdgeStartupTap(manage, stage: "manage-appointments")
        try appointmentEdgeStartupReady(element("appointments-scroll"), stage: "appointments")
        try appointmentEdgeStartupTap(app.buttons["appointment-select-synthetic-edge-appointment-0"], stage: "select-synthetic-appointment")
        print("OROT_APPOINTMENT_EDGE_STARTUP ready")
    }

    @MainActor
    private func appointmentEdgeStartupReady(_ element: XCUIElement, stage: String) throws {
        guard element.waitForExistence(timeout: 10) else {
            print("OROT_APPOINTMENT_EDGE_STARTUP unavailable=\(stage) exists=false")
            throw appointmentEdgeStartupFailure(stage: stage)
        }
        print("OROT_APPOINTMENT_EDGE_STARTUP reached=\(stage)")
    }

    @MainActor
    private func appointmentEdgeStartupTap(_ element: XCUIElement, stage: String) throws {
        try appointmentEdgeStartupReady(element, stage: stage)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated { element.exists && element.isEnabled && element.isHittable }
        }, object: nil)
        guard XCTWaiter.wait(for: [ready], timeout: 5) == .completed else {
            let exists = element.exists
            print("OROT_APPOINTMENT_EDGE_STARTUP unavailable=\(stage) exists=\(exists) enabled=\(exists && element.isEnabled) hittable=\(exists && element.isHittable)")
            throw appointmentEdgeStartupFailure(stage: stage)
        }
        element.tap()
    }

    private func appointmentEdgeStartupFailure(stage: String) -> NSError {
        NSError(domain: "AppointmentEdgeStartup", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing or unusable startup stage: \(stage)"])
    }

    @MainActor
    private func proveAppointmentEdgeDrag(_ app: XCUIApplication, stage: String) throws -> CGRect {
        let scroll = UITestConditions.element(app, "appointments-scroll")
        let primary = UITestConditions.element(app, "appointments-columns-primary")
        let window = try XCTUnwrap(FormWindowOwnership.resolve(app, scroll: scroll, target: primary))
        let back = try NavigationUITestConditions.navigationAction(app, "navigation-back")
        let rail = back.toolbar.frame
        let before = try appointmentEdgeSample(app, after: Date().timeIntervalSince1970 * 1000)
        let owner = try appointmentEdgeFrame(before.page, key: "ownerFrame")
        let windowFrame = try appointmentEdgeFrame(before.dock, key: "windowFrameInScreen")
        let panel = try appointmentEdgeFrame(before.page, key: "primaryFrame")
        try retainAppointmentEdgeSample(before, rail: rail, axWindow: window.frame, stage: "\(stage)-before")
        XCTAssertEqual(window.frame.maxX, windowFrame.maxX, accuracy: 1)
        XCTAssertEqual(before.page["ownerCount"] as? Int, 1)
        XCTAssertEqual(before.page["ownerEnabled"] as? Bool, true)
        let content = try XCTUnwrap(before.page["ownerContentSize"] as? [String: Double])
        XCTAssertGreaterThan(try XCTUnwrap(content["height"]), owner.height, "The synthetic page must have actual vertical scroll range")
        let insets = try XCTUnwrap(before.page["indicators"] as? [String: Any])
        XCTAssertEqual(insets["verticalEnabled"] as? Bool, true)

        if rail.height > rail.width {
            XCTAssertEqual(owner.maxX, windowFrame.maxX, accuracy: 1)
            XCTAssertLessThanOrEqual(panel.maxX, rail.minX + 1, "Readable controls must not extend into the rail")
            XCTAssertEqual(insets["automaticallyAdjusted"] as? Bool, false)
            XCTAssertEqual(try XCTUnwrap(insets["right"] as? Double), 0, accuracy: 0.5)
        }

        let corridor = owner.intersection(panel).intersection(windowFrame)
        XCTAssertGreaterThan(corridor.width, 44)
        XCTAssertGreaterThan(corridor.height, 160)
        let start = CGPoint(x: corridor.midX, y: corridor.minY + 0.75 * corridor.height)
        let end = CGPoint(x: corridor.midX, y: corridor.minY + 0.25 * corridor.height)
        XCTAssertFalse(rail.intersects(CGRect(x: start.x - 1, y: end.y, width: 2, height: start.y - end.y)))
        let origin = window.coordinate(withNormalizedOffset: .zero)
        let from = origin.withOffset(CGVector(dx: start.x - windowFrame.minX, dy: start.y - windowFrame.minY))
        let to = origin.withOffset(CGVector(dx: end.x - windowFrame.minX, dy: end.y - windowFrame.minY))
        from.press(forDuration: 0.12, thenDragTo: to)
        let after = try appointmentEdgeSample(app, after: Date().timeIntervalSince1970 * 1000)
        try retainAppointmentEdgeSample(after, rail: rail, axWindow: window.frame, stage: "\(stage)-after")
        XCTAssertEqual(before.page["ownerID"] as? String, after.page["ownerID"] as? String)
        XCTAssertEqual(before.dock["windowID"] as? String, after.dock["windowID"] as? String)
        let settledOwner = try appointmentEdgeFrame(after.page, key: "ownerFrame")
        // Match the established appointment geometry tolerance; UIKit conversion can round by an ulp after scrolling.
        XCTAssertEqual(settledOwner.minX, owner.minX, accuracy: 0.5)
        XCTAssertEqual(settledOwner.minY, owner.minY, accuracy: 0.5)
        XCTAssertEqual(settledOwner.width, owner.width, accuracy: 0.5)
        XCTAssertEqual(settledOwner.height, owner.height, accuracy: 0.5)
        let offset: ([String: Any]) throws -> Double = { value in
            let offset = try XCTUnwrap(value["ownerOffset"] as? [String: Double])
            return try XCTUnwrap(offset["y"])
        }
        XCTAssertGreaterThan(try offset(after.page), try offset(before.page) + 1, "The actual drag must move the measured UIKit owner")
        let receipt = try JSONSerialization.data(withJSONObject: ["before": before.page, "after": after.page, "rail": ViewportObservation.rect(rail)], options: .sortedKeys)
        let details = XCTAttachment(data: receipt, uniformTypeIdentifier: "public.json")
        details.name = "appointment-edge-geometry-\(stage)"
        details.lifetime = .keepAlways
        add(details)
        // Retain a visual observation separately; screenshots after XCTest idleness may miss a fading indicator.
        let visual = XCTAttachment(screenshot: app.screenshot())
        visual.name = "appointment-edge-visual-\(stage)"
        visual.lifetime = .keepAlways
        add(visual)
        return windowFrame
    }

    /// Retain exact synthetic geometry before asserting it, including on the first genuine failure.
    @MainActor
    private func retainAppointmentEdgeSample(_ sample: (dock: [String: Any], page: [String: Any]), rail: CGRect, axWindow: CGRect, stage: String) throws {
        let raw: [String: Any] = [
            "page": sample.page, "window": sample.dock["windowFrameInScreen"] ?? NSNull(),
            "orientation": sample.dock["orientation"] ?? NSNull(),
            "rail": ViewportObservation.rect(rail), "axWindow": ViewportObservation.rect(axWindow),
        ]
        let data = try JSONSerialization.data(withJSONObject: raw, options: .sortedKeys)
        let report = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        report.name = "appointment-edge-sample-\(stage)"
        report.lifetime = .keepAlways
        add(report)
    }

    @MainActor
    private func appointmentEdgeSample(_ app: XCUIApplication, after timestamp: Double) throws -> (dock: [String: Any], page: [String: Any]) {
        let marker = UITestConditions.element(app, "navigation-test-observation")
        var outcome: (dock: [String: Any], page: [String: Any])?
        var unavailable = "missing-marker"
        let fresh = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated {
                guard marker.exists else { unavailable = "missing-marker"; return false }
                guard let raw = try? JSONSerialization.jsonObject(with: Data(UITestConditions.text(marker).utf8)) as? [String: Any]
                else { unavailable = "invalid-marker"; return false }
                guard let geometry = raw["windowGeometry"] as? [String: Any]
                else { unavailable = "missing-window-geometry"; return false }
                guard let dock = geometry["dockControls"] as? [String: Any]
                else { unavailable = "missing-dock-controls"; return false }
                guard let started = dock["sampleStartedAtMs"] as? Double, started >= timestamp
                else { unavailable = "stale-sample"; return false }
                guard let page = dock["appointmentPage"] as? [String: Any]
                else { unavailable = "missing-appointment-page"; return false }
                guard page["status"] as? String == "sampled"
                else { unavailable = "page-not-sampled"; return false }
                guard let id = dock["windowID"] as? String, page["windowID"] as? String == id
                else { unavailable = "different-window"; return false }
                outcome = (dock, page)
                return true
            }
        }, object: nil)
        let result = XCTWaiter.wait(for: [fresh], timeout: 5)
        if result != .completed {
            print("OROT_APPOINTMENT_EDGE_SAMPLE unavailable=\(unavailable)")
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "appointment-edge-native-sample-failure"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
        XCTAssertEqual(result, .completed, "Require fresh same-window UIKit evidence (\(unavailable))")
        return try XCTUnwrap(outcome)
    }

    private func appointmentEdgeFrame(_ value: [String: Any], key: String) throws -> CGRect {
        let frame = try XCTUnwrap(value[key] as? [String: Double])
        let rect = try CGRect(x: XCTUnwrap(frame["x"]), y: XCTUnwrap(frame["y"]), width: XCTUnwrap(frame["width"]), height: XCTUnwrap(frame["height"]))
        XCTAssertTrue(FormScrollGeometry.valid(rect))
        return rect
    }
}
