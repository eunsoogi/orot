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
        XCTAssertEqual(labels.count, 9)
        let rowTitles = labels.dropFirst().compactMap { $0.split(separator: ",", maxSplits: 1).first.map(String.init) }
        XCTAssertEqual(rowTitles, (2 ... 9).map { "합성 진료 예약 \($0)" })
        XCTAssertTrue(fullyVisible(last) && !fullyVisible(first))
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(primary.frame, primaryFrame) && FormScrollGeometry.stableStageFrame(notice.frame, noticeFrame))
        try captureStageLayout(app, stage: "result-list-end", anchor: anchor)
        let before = last.frame
        last.tap()
        XCTAssertTrue(node(app, "classification-result-reader").waitForAppearance())
        XCTAssertFalse(node(app, id).exists)
        XCTAssertEqual(UITestConditions.text(node(app, "classification-detail-value-0")), "합성 진료 예약 9")
        tap(app, "classification-detail-back")
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            fullyVisible(last) && FormScrollGeometry.stableStageFrame(last.frame, before)
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [restored]), .completed)
        XCTAssertFalse(fullyVisible(first), "Back must not reset the list to the top")
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(last.frame, before))
        return details + labels
    }

    /// Sample the settled product geometry before and after the real repeat confirmation.
    @MainActor
    func assertClassificationCircleRoundTrip(_ app: XCUIApplication, original: CGRect, originalLane: CGRect, expectLeft: Bool, requireDuoWidth: Bool) throws {
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
            XCTAssertEqual(owner.frame.width, 466, accuracy: 2, "Launch intent is not proof of an expanded Duo viewport")
            XCTAssertGreaterThanOrEqual(lane.width, 344)
        }
        if expectLeft {
            XCTAssertLessThan(dock.midX, lane.midX - 20)
            XCTAssertEqual(dock.midY, lane.midY, accuracy: 2)
            XCTAssertLessThanOrEqual(dock.maxX, list.frame.minX)
        } else {
            XCTAssertLessThan(dock.midY, lane.midY - 20)
            XCTAssertEqual(dock.midX, lane.midX, accuracy: 2)
            XCTAssertLessThanOrEqual(dock.maxY, list.frame.minY)
        }
        button.tap()
        XCTAssertTrue(node(app, "medical-appointment-confirmation").waitForAppearance())
        XCTAssertTrue(button.waitForAppearance())
        XCTAssertFalse(node(app, "classification-result-list").exists)
        XCTAssertEqual(UITestConditions.text(node(app, "calendar-classification-synthetic-provider-calls")), "syntheticProviderCalls=2")
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(laneNode.frame, lane))
        XCTAssertTrue(FormScrollGeometry.stableStageFrame(button.frame, dock))
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
                && (expectLeft ? currentCircle.midX > dock.midX + 20 : currentCircle.midY > dock.midY + 20)
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
