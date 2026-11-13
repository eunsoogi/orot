import XCTest

/// Resolves the form's AX window independently from keyboard windows and app envelopes.
@MainActor
enum FormWindowOwnership {
    static func resolve(
        _ app: XCUIApplication, scroll: XCUIElement, target: XCUIElement, reportFailure: Bool = true,
    ) -> XCUIElement? {
        let windows = app.windows.allElementsBoundByIndex.filter(\.exists)
        let scrollID = scroll.identifier
        let targetExists = target.exists
        let targetID = targetExists ? target.identifier : ""
        // Without identifiers, ownership cannot be disambiguated across windows.
        if scrollID.isEmpty || (targetExists && targetID.isEmpty) {
            guard windows.count == 1 else {
                if reportFailure { XCTFail("The form window owner is ambiguous: windows=\(windows.count)") }
                return nil
            }
            return windows[0]
        }
        func counts(_ identifier: String) -> [Int] {
            windows.map { $0.descendants(matching: .any).matching(identifier: identifier).count }
        }
        let scrollCounts = counts(scrollID)
        let targetCounts = targetExists ? counts(targetID) : nil
        guard let index = FormScrollGeometry.matchingOwnerIndex(scrollCounts: scrollCounts, targetCounts: targetCounts) else {
            if reportFailure {
                let frames = windows.map(\.frame)
                XCTFail("Form ownership unavailable: frames=\(frames), scrollCounts=\(scrollCounts), targetCounts=\(String(describing: targetCounts))")
            }
            return nil
        }
        return windows[index]
    }
}
