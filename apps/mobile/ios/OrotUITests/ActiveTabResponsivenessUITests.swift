import XCTest

/// Captures real navigation and scroll delivery against the synthetic local tool.
@MainActor
final class ActiveTabResponsivenessUITests: OrotFailFastTestCase {
    private struct Step {
        let sequence: UInt64
        let start: UInt64
        let end: UInt64
        let result: String
    }

    private func snapshot(_ app: XCUIApplication) throws -> [String: Any] {
        let marker = UITestConditions.element(app, "active-tab-native-observation")
        XCTAssertTrue(UITestConditions.exists(marker))
        let raw = try XCTUnwrap(marker.value as? String)
        let data = try XCTUnwrap(raw.data(using: .utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func steps(_ snapshot: [String: Any]) throws -> [Step] {
        let sql = try XCTUnwrap(snapshot["sql"] as? String)
        guard !sql.contains("overflow") else { throw NSError(domain: "ActiveTabTrace", code: 4) }
        let parsed = try sql.split(separator: "\n").map { line in
            let fields = line.split(separator: " ")
            guard fields.count == 4, let sequence = UInt64(fields[0]), let start = UInt64(fields[1]),
                  let end = UInt64(fields[2])
            else {
                throw NSError(domain: "ActiveTabTrace", code: 1)
            }
            return Step(sequence: sequence, start: start, end: end, result: String(fields[3]))
        }
        guard parsed.first?.sequence == 1,
              parsed.last?.result == "terminal",
              parsed.dropLast().last?.result == "terminal-row",
              parsed.dropLast(2).last?.result == "done",
              parsed.dropLast(2).contains(where: { $0.result == "row" }),
              parsed.dropLast(2).allSatisfy({ ["row", "done"].contains($0.result) }),
              parsed.allSatisfy({ $0.start < $0.end }),
              zip(parsed, parsed.dropFirst()).allSatisfy({ $0.0.sequence + 1 == $0.1.sequence })
        else { throw NSError(domain: "ActiveTabTrace", code: 4) }
        return parsed
    }

    private func waitForState(_ state: XCUIElement, expected: String) {
        let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard state.exists else { return false }
            let values = [state.label, state.value as? String ?? ""]
            return values.contains(expected) || values.contains("failed") || values.contains("unavailable")
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [outcome]), .completed)
        XCTAssertTrue(state.label == expected || (state.value as? String) == expected, state.debugDescription)
    }

    private func tick(_ event: [String: Any]) throws -> UInt64 {
        try XCTUnwrap((event["tick"] as? NSNumber)?.uint64Value)
    }

    /// Proves tap overlap independently of later destination loading and drag.
    /// Missing SQL, route, or scroll evidence is an error, including for controls.
    private func overlap(
        _ final: [String: Any],
        readiness: [String: Any],
        target: String,
        destination: String,
        expectedScroll: String,
    ) throws -> (overlapped: Bool, touch: UInt64, visible: UInt64, scroll: UInt64, lastSQL: UInt64) {
        guard final["overflow"] as? Bool == false,
              final["truncated"] as? Bool == false,
              readiness["truncated"] as? Bool == false,
              let finalRun = final["run"] as? String,
              let readyRun = readiness["run"] as? String,
              finalRun.caseInsensitiveCompare(readyRun) == .orderedSame,
              (readiness["visible"] as? [String])?.contains(destination) == true
        else { throw NSError(domain: "ActiveTabTrace", code: 3) }
        let sqlSteps = try steps(final)
        guard let lastSQL = sqlSteps.map(\.end).max()
        else {
            throw NSError(domain: "ActiveTabTrace", code: 4)
        }
        let events = try XCTUnwrap(final["events"] as? [[String: Any]])
        let visible = try XCTUnwrap((readiness["sampleTick"] as? NSNumber)?.uint64Value)
        let touch = try XCTUnwrap(events.last { ($0["target"] as? String) == target && ($0["phase"] as? Int) == 0 })
        let touchAt = try tick(touch)
        let touchID = try XCTUnwrap(touch["touch"] as? Int)
        let gestures = events.filter {
            ($0["scroll"] as? Int ?? 0) > 0 && ($0["touch"] as? Int) != touchID &&
                ($0["scrollTarget"] as? String) == expectedScroll &&
                ($0["scrollRoute"] as? String) == destination
        }
        for first in gestures {
            guard let owner = first["scroll"] as? Int, owner > 0,
                  let gesture = first["touch"] as? Int,
                  let initial = first["offset"] as? Double else { continue }
            for last in gestures where (last["scroll"] as? Int) == owner && (last["touch"] as? Int) == gesture {
                guard let offset = last["offset"] as? Double, offset != initial else { continue }
                let before = try tick(first)
                let after = try tick(last)
                guard touchAt < visible, visible <= before, before < after else { continue }
                let matched = sqlSteps.contains { ["row", "done"].contains($0.result) && $0.start < touchAt && touchAt < $0.end }
                return (matched, touchAt, visible, after, lastSQL)
            }
        }
        throw NSError(domain: "ActiveTabTrace", code: 5)
    }

    private func exercise(target: String, destination: String, negative: Bool) throws {
        let app = XCUIApplication()
        let run = UUID().uuidString
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "active-tab-workload",
            "-OROT_WORKLOAD_SESSION", run,
            "-OROT_PROVIDER_DIAGNOSTICS",
        ] + (negative ? ["-OROT_WORKLOAD_HOLD_SETTLEMENT", "YES"] : [])
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        waitForState(UITestConditions.element(app, "active-tab-workload-state"), expected: "ready")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "active-tab-workload-start")))
        if target == "schedule-open-appointments" {
            try NavigationUITestConditions.tapNavigation(app, "navigation-tab-records")
            UITestConditions.element(app, "records-section-schedule").tap()
            XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, target)))
        }
        let baseline = try snapshot(app)
        XCTAssertEqual((baseline["run"] as? String)?.lowercased(), run.lowercased())
        XCTAssertFalse((baseline["visible"] as? [String] ?? []).contains(destination))
        UITestConditions.element(app, "active-tab-workload-start").tap()
        if negative {
            let state = UITestConditions.element(app, "active-tab-workload-state")
            waitForState(state, expected: "sql-complete")
        }
        if target.hasPrefix("navigation-tab") {
            try NavigationUITestConditions.tapNavigation(app, target)
        } else {
            UITestConditions.element(app, target).tap()
        }
        try ActiveTabReadinessUITestConditions.wait(app, destination: destination)
        let readiness = try snapshot(app)
        let scrollID = destination == "appointments-scroll" ? destination : "navigation-route-scroll"
        let scroll = UITestConditions.element(app, scrollID)
        XCTAssertTrue(UITestConditions.exists(scroll) && scroll.isHittable)
        scroll.swipeUp()
        if negative {
            UITestConditions.element(app, "active-tab-workload-release").tap()
        }
        let state = UITestConditions.element(app, "active-tab-workload-state")
        waitForState(state, expected: "finished")
        let final = try snapshot(app)
        XCTAssertEqual((readiness["run"] as? String)?.lowercased(), run.lowercased())
        XCTAssertEqual((final["run"] as? String)?.lowercased(), run.lowercased())
        let attachment = XCTAttachment(string: String(describing: final))
        attachment.name = "Synthetic active tab native observations"
        attachment.lifetime = .keepAlways
        add(attachment)
        let result = try overlap(final, readiness: readiness, target: target, destination: destination, expectedScroll: scrollID)
        if destination == "overview-screen" {
            try ActiveTabReadinessUITestConditions.overviewReceipt(final, run: run, after: result.touch, before: result.visible)
        } else {
            let route = destination == "records-layout" ? "records" : "appointments"
            let after = route == "records" ? nil : result.touch
            try ActiveTabReadinessUITestConditions.directReceipt(final, run: run, route: route, after: after, before: result.visible)
        }
        let timing = XCTAttachment(string: "touch=\(result.touch) visible=\(result.visible) scroll=\(result.scroll) lastSQL=\(result.lastSQL)")
        timing.name = "Synthetic active tab timing ticks"
        timing.lifetime = .keepAlways
        add(timing)
        if negative {
            XCTAssertGreaterThan(result.touch, result.lastSQL)
        }
        XCTAssertEqual(result.overlapped, !negative, "Input outside a successful native step cannot prove overlap.")
    }

    func testRecordsDuringActiveTool() throws {
        try exercise(target: "navigation-tab-records", destination: "records-layout", negative: false)
    }

    func testOverviewDuringActiveTool() throws {
        try exercise(target: "navigation-tab-overview", destination: "overview-screen", negative: false)
    }

    func testAppointmentsDuringActiveTool() throws {
        try exercise(target: "schedule-open-appointments", destination: "appointments-scroll", negative: false)
    }

    func testPostSQLInputDoesNotCountAsOverlap() throws {
        try exercise(target: "navigation-tab-records", destination: "records-layout", negative: true)
    }

    func testAppointmentsScrollDuringActiveTool() throws {
        let app = XCUIApplication()
        let run = UUID().uuidString
        app.launchArguments = [
            "-OROT_TEST_SCENARIO", "active-tab-workload",
            "-OROT_WORKLOAD_SESSION", run,
            "-OROT_PROVIDER_DIAGNOSTICS",
        ]
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        waitForState(UITestConditions.element(app, "active-tab-workload-state"), expected: "ready")
        XCTAssertTrue(UITestConditions.exists(UITestConditions.element(app, "active-tab-workload-start")))
        try NavigationUITestConditions.tapNavigation(app, "navigation-tab-records")
        UITestConditions.element(app, "records-section-schedule").tap()
        UITestConditions.element(app, "schedule-open-appointments").tap()
        try ActiveTabReadinessUITestConditions.wait(app, destination: "appointments-scroll")
        let scroll = UITestConditions.element(app, "appointments-scroll")
        XCTAssertTrue(scroll.isHittable)
        let ready = try snapshot(app)
        XCTAssertTrue((ready["visible"] as? [String] ?? []).contains("appointments-scroll"))
        UITestConditions.element(app, "active-tab-workload-start").tap()
        scroll.swipeUp()
        let state = UITestConditions.element(app, "active-tab-workload-state")
        waitForState(state, expected: "finished")
        let final = try snapshot(app)
        guard (ready["run"] as? String)?.lowercased() == run.lowercased(),
              (final["run"] as? String)?.lowercased() == run.lowercased(),
              ready["truncated"] as? Bool == false,
              final["overflow"] as? Bool == false, final["truncated"] as? Bool == false
        else {
            throw NSError(domain: "ActiveTabTrace", code: 6)
        }
        let events = try XCTUnwrap(final["events"] as? [[String: Any]]).filter {
            ($0["scroll"] as? Int ?? 0) > 0 &&
                ($0["scrollTarget"] as? String) == "appointments-scroll" &&
                ($0["scrollRoute"] as? String) == "appointments-scroll"
        }
        let sql = try steps(final)
        var observed = false
        for first in events {
            for last in events where (first["touch"] as? Int) == (last["touch"] as? Int) &&
                (first["scroll"] as? Int) == (last["scroll"] as? Int)
            {
                guard let startOffset = first["offset"] as? Double,
                      let endOffset = last["offset"] as? Double, startOffset != endOffset else { continue }
                let start = try tick(first)
                let end = try tick(last)
                if sql.contains(where: { ["row", "done"].contains($0.result) && $0.start < start && start < end && end < $0.end }) {
                    observed = true
                }
            }
        }
        XCTAssertTrue(observed, "A real scroll displacement must overlap an individual SQLite step.")
    }
}
