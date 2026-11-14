import XCTest

final class QCWorkflowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<12 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.exists && element.isHittable, "Control must be reachable by scrolling: \(element)")
    }
    private func assertSignedOutQC(_ app: XCUIApplication, english: Bool = false) {
        let banner = app.staticTexts["qc-review-only"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertFalse(banner.label.isEmpty)
        let connection = app.staticTexts["qc-connection-state"]
        reveal(connection, in: app)
        XCTAssertFalse(connection.label.isEmpty)
        if english { XCTAssertTrue(connection.label.contains("Server not connected")) }
        reveal(app.textFields["qc-name"], in: app)
        reveal(app.secureTextFields["qc-pin"], in: app)
        let login = app.buttons["qc-login"]
        reveal(login, in: app)
        XCTAssertFalse(login.isEnabled, "No credentials must not sign in")
        XCTAssertFalse(app.buttons["qc-logout"].exists)
        XCTAssertFalse(app.staticTexts["ACCEPT"].exists)
        XCTAssertFalse(app.staticTexts["HOLD"].exists)
    }
    func testReviewOnlyEntryAtMaximumDynamicType() {
        let app = XCUIApplication()
        // Use the real entry point, without a session, server or fabricated workspace.
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-AppleLanguages", "(en)"]
        app.launch()
        let entry = app.buttons["Incoming fabric QC"]
        reveal(entry, in: app)
        entry.tap()
        assertSignedOutQC(app, english: true)
    }
    func testUrduEntryHasAccessibleSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["--qc", "-AppleLanguages", "(ur)", "-AppleLocale", "ur_PK"]
        app.launch()
        assertSignedOutQC(app)
        XCTAssertNotEqual(app.staticTexts["qc-review-only"].label, "REVIEW ONLY — automatic authority is not released")
    }
}
