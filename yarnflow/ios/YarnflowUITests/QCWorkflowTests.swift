import XCTest

final class QCWorkflowTests: XCTestCase {
    func testReviewOnlyEntryAtMaximumDynamicType() {
        let app = XCUIApplication()
        app.launchArguments = ["--qc", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.staticTexts["qc-review-only"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.secureTextFields["qc-pin"].exists)
        XCTAssertTrue(app.buttons["qc-login"].exists)
    }
    func testUrduEntryHasAccessibleSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["--qc", "-AppleLanguages", "(ur)", "-AppleLocale", "ur_PK"]
        app.launch()
        XCTAssertTrue(app.staticTexts["qc-review-only"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["qc-login"].exists)
        XCTAssertTrue(app.textFields["qc-name"].exists)
    }
}
