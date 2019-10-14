const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

/* eslint-disable no-else-return */
/* eslint-disable no-console */

/**
 *
 * !! This parser requires that the multiple Serenity JSON result files
 * !! are concatenated into a single payload object as a JSON array.
 *
 * Takes serenity format test result and converts it to qtest format
 *
 * qTest has:
 *
 *    Failed
 *    Incomplete
 *    Blocked
 *    Passed
 *    Unexecuted
 *
 * Serenity has:
 *
 * @param serenityStatus serenity output test result
 * @returns {string} corresponding qtest format test result
 */
 function convertSerenityStatusToQtestStatus(serenityStatus) {
  switch (String(serenityStatus.toUpperCase())) {
    case "SUCCESS":
      return "passed";
    case "SKIPPED":
      return "unexecuted";
    case "FAILED":
    case "FAILURE":
    case "BROKEN":
    case "ERROR":
      return "failed";
    case "PENDING":
      return "blocked";
    case "UNDEFINED":
      return "failed";
    default:
      throw `Unknown serenity status ${serenityStatus}`;
  }
}

/**
 * Process the serenity bdd scenario and create a qtest format report
 * @param scenario scenario to process
 * @param order Order of the scenario (not really required)
 * @returns {{exe_end_date: Date, module_names: string[], name: *, automation_content: string, exe_start_date: Date, test_step_logs: Array, properties: Array, status: string, order: *}}
 */
 function processTestResult(scenario, order) {
  const featureName = scenario.userStory.storyName;
  console.log(`Feature: ${featureName}`);
  console.log(`Scenario: ${scenario.name}`);

  const testStepLogs = [];

  /**
   * Processes one step and any recursively parses children if there are any
   * @param testStep The current step to parse
   */
  function processTestStep(testStep) {
    console.log(`Step: ${testStep.description}`);

    const qtestStatus = convertSerenityStatusToQtestStatus(testStep.result);

    let actual = testStep.description;
    if (qtestStatus === "failed") {
      actual = testStep.exception.message;
    }

    let stepAttachments = [];
    // FIXME: This is called 'attachments' in serenity reports?
    if (testStep.embeddings !== undefined) {
      stepAttachments = testStep.embeddings.map((att, attCount) => {
        const attachment = {
          name: `${testStep.description} Attachment ${attCount}`,
          content_type: att.mime_type,
          data: att.data
        };
        console.debug(`Attachment: ${attachment.description}`);

        return attachment;
      });
    }

    const stepLog = {
      description: testStep.description,
      expected_result: testStep.description,
      actual_result: actual,
      // Do -1 because '0' is the scenario itself in the serenity report
      order: testStep.number - 1,
      status: qtestStatus,
      attachments: stepAttachments
    };

    testStepLogs.push(stepLog);



    if (typeof testStep.children === "undefined") {
      console.log("No testStep children, moving on...");
    } else {
      console.debug(`${testStep.children.length} children to process`);
      // Process all children
      testStep.children.map(processTestStep);
    }
  }

  scenario.testSteps.map(processTestStep);

    // Set the step order here
  // Step orders can be a bit confusing because of multiple nested
  for (let i = 0; i < testStepLogs.length; i++) {
    testStepLogs[i].order = i;
  }
  const scenarioId = scenario.id;
  const scenarioName = scenario.name;
  const propertyArr = [];


  const startDate = new Date(scenario.startTime.replace(/\[.*?\]/g, ""));
  const endDate = new Date(startDate + scenario.duration);

  const reportingLog = {
    exe_start_date: startDate,
    exe_end_date: endDate,
    module_names: [featureName],
    name: scenarioName,
    automation_content: `${scenario.userStory.path}#${scenarioId}`,
    build_number: "10",
    build_url: "http://localhost:8080/jenkins",
    properties: propertyArr,
    status: convertSerenityStatusToQtestStatus(scenario.result),
    order: order,
    test_step_logs: testStepLogs
  };

  console.debug(reportingLog);

  return reportingLog;
}

/**
 * Splits out 'examples' into separate test results, if there are any
 * @param testResult The original result for a test in the serenity file
 * @returns {*}
 */
 function splitExamples(testResult) {
  // Magic thing Serenity puts into test results
  const hasExamples = testResult.dataTable !== undefined;

  if (!hasExamples) {
    return [testResult];
  }

  console.debug(`${testResult.name} has examples`);

  return testResult.testSteps.map((example, order) => {
    return {
      // Copy original test results
      //...testResult,
      // Clear 'data table' - not used in qtest
      //dataTable: {},
      // Copy result from the specific example
      //result: testResult.dataTable.rows[order].result,
      // Copy only the test results we care about
      // NOTE: This makes a 'dummy' step with the "Example #1: ..." at the start
      //testSteps: [example]

      // Copy original test results
      ...testResult,
      // Ovverride some things to make them display nicely in qtest
      name: testResult.name + " - Example #" + (order + 1),
      id: testResult.id + ";" + (order + 1),
      // Clear 'data table' - not used in qtest
      dataTable: {},
      // Copy result from the specific example
      result: testResult.dataTable.rows[order].result,
      // Copy only the test results we care about
      // NOTE: This makes a 'dummy' step with the "Example #1: ..." at the start
      testSteps: [example]
    };
  });
}

const concat = (x, y) => x.concat(y);

const flatMap = (f, xs) => xs.map(f).reduce(concat, []);

/**
 * Process payload into correct format
 * @param payload body of request - list of test results
 * @returns {{projectId: *, "test-cycle": *, logs: *}}
 */
 function processPayload(payload) {
  //const { projectId, requiresDecode, foldername } = payload;  
  const { projectId, requiresDecode } = payload;
  const cycleId = payload["test-cycle"];

  let testResults = payload.result;

  if (requiresDecode === "true" || requiresDecode === true) {
    testResults = JSON.parse(testResults);
  }

  testResults = flatMap(splitExamples, testResults);
  const testLogs = testResults.map(processTestResult);

/*
// Use this in conjunction with line 201 and a payload object 'foldername' to determine a lower level folder structure.

  testLogs.forEach(item => {
    item.module_names.push(foldername);
  });
*/  

  return {
    projectId,
    "test-cycle": cycleId,
    logs: testLogs
  };
}

/**
 * Send event to qtest
 */
function emitEvent(triggers, name, payload) {
  const { Webhooks } = require("@qasymphony/pulse-sdk");

  const t = triggers.find(item => item.name === name);
  return t && new Webhooks().invoke(t, payload);
}

exports.handler = function(
  { event: body, constants, triggers },
  context,
  callback
) {
  const formattedResults = processPayload(body);

  emitEvent(triggers, "UpdateQTestWithFormattedResults", formattedResults);
};
