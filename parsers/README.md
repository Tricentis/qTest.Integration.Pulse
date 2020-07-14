## Framework and Tool Parsers

The name of the parser indicates the framework or tool as well as the expected results output data format.  HTML is not supported or encouraged as a standardized data format.

- All framework and tool parsers listed here leverage the delivery scripts and UpdateQTestWithResults.js submission method found in this repository.  See the 'delivery' and 'qtest' subdirectories.
- These actions are NOT compatible with the stock Pulse 9.1 BDD workflow rules as these rules incorporate standards and conventions not used in the stock rules.
- These actions are NOT compatible with the parsers included in Launch due to a difference between utilized qTest API endpoints.

### FormatJUnitXML.js
This is a parser for JUnit XML result files.  It may also support XUnit result files.

### FormatJavaCucumberJSON.js
This is a parser for Cucumber for Java 4.0+ JSON result files.  Earlier versions of Cucumber need to use the Legacy parser.  Required for the qTest Scenario workflow.

### FormatLegacyJavaCucumberJSON.js
This is a parser for Cucumber for Java 1.0-3.0+ JSON result files.  This is not compatible with Cucumber 4.0+.  You should probably upgrade.

### FormatPostmanJSON.js
This is a parser for Postman JSON results output.  This is a more detailed parser than the one included with Launch, and thus not compatible.

### FormatSerenityJSON.js
This is a parser for the Serenity BDD XML format, a Cucumber derivative.  This parser has been submitted for public use by our friends at Specsavers UK.

### FormatSonarQubeJSON.js
This is a parser for the SonarQube JSON format for code quality and assurance.  Leverage the webhook calls in SonarQube, please see this article to configure and review the expected format: https://docs.sonarqube.org/latest/project-administration/webhooks/

### FormatSpecFlowXML.js
This is a parser for Tricents SpecFlow product TRX XML result files.  It does not support HTML report output.

### FormatTestNGXML.js
This is a parser for TestNG XML results files.  It does not support Extent HTML reports.

### FormatToscaXML.js
This is a parser for Tricentis Tosca JUnit style XML results files.  It is a work in progress and may require customization for your environment.
