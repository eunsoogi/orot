import XCTest

extension AppointmentConsentUITests {
    /// Traverse real row hit targets and verify the native offset after closing the last detail.
    @MainActor
    func readScrollableResults(_ app: XCUIApplication, anchor: ClassificationStageWindowAnchor?) throws -> [String] {
        let id = "classification-result-list"
        XCTAssertTrue(node(app, id).waitForAppearance())
        let list = classificationListScroll(app)
        let primary = node(app, "medical-appointment-import"), notice = node(app, "classification-result-notice")
        let primaryFrame = primary.frame, noticeFrame = notice.frame
        XCTAssertTrue(notice.isHittable && FormScrollGeometry.valid(noticeFrame))
        XCTAssertLessThanOrEqual(noticeFrame.maxY, list.frame.minY + 1)
        XCTAssertFalse(primaryFrame.intersects(list.frame))
        for arrow in ["medical-appointment-previous-result", "medical-appointment-next-result"] {
            XCTAssertFalse(node(app, arrow).exists)
        }
        let rows = list.buttons.matching(identifier: "classification-result-row")
        func fullyVisible(_ row: XCUIElement) -> Bool {
            row.exists && row.isHittable && row.frame.height >= 44 && list.frame.insetBy(dx: -1, dy: -1).contains(row.frame)
        }
        let first = rows.firstMatch
        XCTAssertTrue(fullyVisible(first))
        try captureStageLayout(app, stage: "result-list-start", anchor: anchor)
        first.tap()
        XCTAssertTrue(node(app, "classification-result-reader").waitForAppearance())
        XCTAssertFalse(node(app, id).exists, "The retained list must not compete with detail in accessibility")
        let details = readSingleResultDetail(app)
        XCTAssertTrue(node(app, id).waitForAppearance())
        var labels: [String] = []
        let last = rows.matching(NSPredicate(format: "label BEGINSWITH %@", "합성 진료 예약 9,")).firstMatch
        for _ in 0 ..< 32 {
            for row in rows.allElementsBoundByIndex where fullyVisible(row) && !labels.contains(row.label) {
                labels.append(row.label)
            }
            if fullyVisible(last) {
                break
            }
            let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
            let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertFalse(fullyVisible(first))
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(primary.frame, primaryFrame) && FormScrollGeometry.stableStageFrame(notice.frame, noticeFrame))
        try captureStageLayout(app, stage: "result-list-end", anchor: anchor)
        var beforeSample = waitForSettledClassificationRow(in: list, row: last)
        if beforeSample == nil, last.exists {
            // A projected AX row may exist below the clipped viewport. Move it explicitly,
            // instead of letting XCTest auto-scroll it as part of the detail tap.
            let viewport = list.frame, row = last.frame
            if FormScrollGeometry.valid(viewport), FormScrollGeometry.valid(row), row.maxY > viewport.maxY {
                let distance = min(viewport.height * 0.35, max(32, row.maxY - viewport.maxY + 12))
                let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
                let end = start.withOffset(CGVector(dx: 0, dy: -distance))
                start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
                beforeSample = waitForSettledClassificationRow(in: list, row: last)
            }
        }
        guard let beforeSample, last.isHittable else {
            XCTFail("Refusing to tap an unsettled/clipped last row: viewport=\(list.frame), row=\(last.frame)")
            throw ActivationError.unproven
        }
        if !labels.contains(last.label) {
            labels.append(last.label)
        }
        XCTAssertEqual(labels.count, 9)
        let rowTitles = labels.dropFirst().compactMap { $0.split(separator: ",", maxSplits: 1).first.map(String.init) }
        XCTAssertEqual(rowTitles, (2 ... 9).map { "합성 진료 예약 \($0)" })
        let before = beforeSample.row, listBefore = beforeSample.viewport
        last.tap()
        XCTAssertTrue(node(app, "classification-result-reader").waitForAppearance())
        XCTAssertFalse(node(app, id).exists)
        XCTAssertEqual(UITestConditions.text(node(app, "classification-detail-value-0")), "합성 진료 예약 9")
        tap(app, "classification-detail-back")
        // Use fresh AX queries and a bounded wait for the route and named row.
        // Repeated hit tests inside a polling predicate can each request a full AX snapshot.
        guard node(app, id).waitForExistence(timeout: 4) else {
            XCTFail("Back did not reveal the results list; before=\(listBefore) row=\(before)")
            throw ActivationError.unproven
        }
        let returnedList = classificationListScroll(app)
        let returnedRows = returnedList.buttons.matching(identifier: "classification-result-row")
        let returnedLast = returnedRows.matching(NSPredicate(format: "label BEGINSWITH %@", "합성 진료 예약 9,")).firstMatch
        guard returnedLast.waitForExistence(timeout: 4) else {
            XCTFail("Back did not reveal the named last row; before=\(before) list=\(returnedList.frame)")
            throw ActivationError.unproven
        }
        guard let afterSample = waitForSettledClassificationRow(in: returnedList, row: returnedLast) else {
            XCTFail("Back did not settle a fully visible last row; row before=\(before) after=\(returnedLast.frame), list before=\(listBefore) after=\(returnedList.frame)")
            throw ActivationError.unproven
        }
        let after = afterSample.row, listAfter = afterSample.viewport
        let revealedFirst = returnedRows.firstMatch
        let firstAfter = revealedFirst.exists ? revealedFirst.frame : .null
        XCTContext.runActivity(named: "Classification Back geometry: row before=\(before) after=\(after), list before=\(listBefore) after=\(listAfter), first after=\(firstAfter)") { _ in }
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(listAfter, listBefore), "The list viewport must not move on Back")
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(after, before), "The last row must retain its exact frame on Back")
        XCTAssertTrue(listAfter.insetBy(dx: -1, dy: -1).contains(after) && returnedLast.isHittable)
        XCTAssertFalse(listAfter.insetBy(dx: -1, dy: -1).contains(firstAfter), "Back must not reset the list to the top")
        return details + labels
    }

    /// Require two consecutive fresh coordinate samples before trusting clipping and offset.
    /// Hittability is checked once outside the poll to avoid repeated full AX hit tests.
    @MainActor
    private func waitForSettledClassificationRow(in list: XCUIElement, row: XCUIElement) -> (viewport: CGRect, row: CGRect)? {
        var previous: (viewport: CGRect, row: CGRect)?
        var settled: (viewport: CGRect, row: CGRect)?
        let frames = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard list.exists, row.exists else {
                previous = nil
                return false
            }
            let sample = (viewport: list.frame, row: row.frame)
            defer { previous = sample }
            guard FormScrollGeometry.valid(sample.viewport), FormScrollGeometry.valid(sample.row),
                  sample.row.height >= 44, sample.viewport.contains(sample.row),
                  let previous, previous.viewport.contains(previous.row),
                  FormScrollGeometry.stableStageFrame(sample.viewport, previous.viewport),
                  FormScrollGeometry.stableStageFrame(sample.row, previous.row)
            else { return false }
            settled = sample
            return true
        }, object: nil)
        return XCTWaiter().wait(for: [frames], timeout: 2) == .completed ? settled : nil
    }

    /// Record and validate settled product geometry before any list or detail gestures.
    @MainActor
    func assertClassificationCircleDock(_ app: XCUIApplication, original: CGRect, originalLane: CGRect, expectLeft: Bool, requireDuoWidth: Bool) throws -> CGRect {
        let slot = node(app, "classification-circle-slot")
        let button = node(app, "medical-appointment-import")
        let list = classificationListScroll(app)
        XCTAssertTrue(slot.exists && button.isHittable)
        let dock = button.frame
        let hostID = "classification-moving-stage"
        let owner = try FormWindowOwnership.resolveStage(app, observed: nil, required: [hostID, "classification-circle-slot", "classification-result-list"])
        let laneNode = node(app, hostID)
        let lane = laneNode.frame
        // The fixture adds a saved marker above the route after the first run.
        // Compare each real native circle against its current usable lane.
        XCTAssertTrue(originalLane.contains(original) && lane.contains(dock))
        XCTAssertEqual(original.midX, originalLane.midX, accuracy: 2)
        XCTAssertEqual(original.midY, originalLane.midY, accuracy: 2)
        XCTContext.runActivity(named: "Classification dock: window=\(owner.frame), initialLane=\(originalLane), lane=\(lane), central=\(original), docked=\(dock), list=\(list.frame)") { _ in }
        if requireDuoWidth {
            try assertNativeExpandedClassificationWindow(app, owner: owner.frame)
            XCTAssertGreaterThanOrEqual(min(owner.frame.width, owner.frame.height), 650, "A folded Duo cannot prove flat expanded layout")
            XCTAssertGreaterThanOrEqual(dock.minX - lane.minX, 12)
            XCTAssertGreaterThanOrEqual(list.frame.minX - dock.maxX, 20)
        }
        let listFrame = list.frame
        let sideOrder = dock.midX < lane.midX - 20 && abs(dock.midY - lane.midY) <= 2 && dock.maxX <= listFrame.minX
        let stackedOrder = dock.midY < lane.midY - 20 && abs(dock.midX - lane.midX) <= 2 && dock.maxY <= listFrame.minY
        guard expectLeft ? sideOrder : stackedOrder else {
            XCTFail("Wrong classification dock: expectLeft=\(expectLeft), lane=\(lane), circle=\(dock), list=\(listFrame)")
            throw ActivationError.unproven
        }
        return dock
    }

    /// Match the current UIKit reservation snapshot against the committed RN sensor.
    @MainActor
    private func assertNativeExpandedClassificationWindow(_ app: XCUIApplication, owner: CGRect) throws {
        typealias Payload = NavigationGeometryReservedRegionMatcher.GeometryPayload
        let receipt = try XCTUnwrap(NavigationUITestConditions.observationSnapshot(app, testCase: self, attachmentName: "classification-expanded-native-window"))
        let native = try XCTUnwrap(receipt["windowGeometry"] as? [String: Any])
        let events = try XCTUnwrap(receipt["lifecycle"] as? [[String: Any]])
        let context = try XCTUnwrap(events.last { $0["event"] as? String == "window-geometry-context" })
        let committedJSON = try XCTUnwrap(context["normalizedSnapshot"] as? String)
        let committed = try JSONDecoder().decode(Payload.self, from: Data(committedJSON.utf8))
        let observed = try JSONDecoder().decode(Payload.self, from: JSONSerialization.data(withJSONObject: native))
        let window = observed.windowBounds
        let sameWindow = abs(window.width - owner.width) <= 1 && abs(window.height - owner.height) <= 1
        let bounds = CGRect(x: window.x, y: window.y, width: window.width, height: window.height)
        let divisions = observed.reservedRegions.filter { region in
            let frame = region.frame
            return region.kind == "division" && frame.width > 0 && frame.height > 0
                && bounds.intersects(CGRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height))
        }
        XCTAssertTrue(sameWindow && observed.matches(committed) && observed.reservedRegionsSupported)
        XCTAssertFalse(divisions.isEmpty, "Open evidence needs a real in-window UIKit division")
        XCTAssertTrue(divisions.allSatisfy { !$0.isActive }, "An active seam does not certify the flat posture")
    }

    /// Reclassify returns the circle to center before Start, then progress uses that same frame.
    @MainActor
    func assertClassificationCircleReturn(_ app: XCUIApplication, dock: CGRect, expectLeft: Bool) {
        let laneNode = node(app, "classification-moving-stage")
        let lane = laneNode.frame
        let slot = node(app, "classification-circle-slot")
        let button = node(app, "medical-appointment-import")
        button.tap()
        XCTAssertTrue(node(app, "medical-appointment-confirmation").waitForAppearance())
        XCTAssertTrue(button.waitForAppearance())
        XCTAssertFalse(node(app, "classification-result-list").exists)
        XCTAssertEqual(UITestConditions.text(node(app, "calendar-classification-synthetic-provider-calls")), "syntheticProviderCalls=2")
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(laneNode.frame, lane))
        let returned = button.frame
        XCTAssertTrue(lane.contains(returned))
        XCTAssertEqual(returned.midX, lane.midX, accuracy: 2)
        XCTAssertEqual(returned.midY, lane.midY, accuracy: 2)
        XCTAssertEqual(returned.width, dock.width, accuracy: 2)
        XCTAssertEqual(returned.height, dock.height, accuracy: 2)
        XCTAssertTrue(expectLeft ? returned.midX > dock.midX + 20 : returned.midY > dock.midY + 20)
        XCTAssertFalse(node(app, "medical-appointment-progress").exists)
        if button.label == "전체 화면으로 내용 보기" {
            button.tap()
            XCTAssertTrue(node(app, "classification-close-reader").waitForAppearance())
        }
        tap(app, "medical-appointment-import")
        let center = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard self.node(app, "medical-appointment-progress").exists, slot.exists,
                  laneNode.exists else { return false }
            let currentLane = laneNode.frame, currentCircle = slot.frame
            return currentLane.contains(currentCircle)
                && abs(currentCircle.midX - currentLane.midX) <= 2
                && abs(currentCircle.midY - currentLane.midY) <= 2
                && abs(currentCircle.width - returned.width) <= 2
                && abs(currentCircle.height - returned.height) <= 2
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [center]), .completed)
        XCTAssertFalse(node(app, "classification-result-list").exists)
        XCTAssertFalse(button.exists)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "classification-circle-slot").count, 1)
    }

    /// Accept only the unique native scroll surface, including Fabric's layout-only wrapper projection.
    @MainActor
    private func classificationListScroll(_ app: XCUIApplication) -> XCUIElement {
        let matches = app.descendants(matching: .any).matching(identifier: "classification-result-list")
        XCTAssertEqual(matches.count, 1)
        let tagged = matches.firstMatch
        let scroll = tagged.elementType == .scrollView ? tagged : tagged.scrollViews.firstMatch
        XCTAssertEqual(tagged.scrollViews.count, tagged.elementType == .scrollView ? 0 : 1)
        XCTAssertTrue(scroll.exists && FormScrollGeometry.valid(scroll.frame) && tagged.frame.insetBy(dx: -1, dy: -1).contains(scroll.frame))
        return scroll
    }
}
