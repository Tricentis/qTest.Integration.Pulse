const ScenarioSdk = require('@qasymphony/scenario-sdk');

const StepSdk = {
    getStepSdk(qtestToken, scenarioProjectId, scenarioURL) {
        return new ScenarioSdk.Steps({ qtestToken, scenarioProjectId, scenarioURL });
    }
}

const Steps = {
    updateStepResults(stepSdk, name, status, issueId = null, keyword = null) {
        return stepSdk.getSteps(name, keyword, issueId). // issueId only available from Pulse v9.2
            then(steps => Promise.all(steps.map(step => stepSdk.updateStep(step.id, Object.assign(step, { status })))))
            .catch(function (err) {
                console.log('Error updating colors: ', err);
            });
    }
};

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    var payload = body;
    var testLogs = payload.logs;

    stepSdk = StepSdk.getStepSdk(constants.QTEST_TOKEN, constants.ScenarioProjectID, constants.Scenario_URL);
    
    for (var res of testLogs) {
        for (var step of res["test_step_logs"]) {
            // If for any reason you change the step description be certain to edit the following line to create a match for the Scenario SDK!!
            var stepName = step.description.slice(step.description.indexOf(' ')).trim();
            var stepStatus = step.status;
            var stepKeyword = step.keyword;
            var issueId = step.issueId;

            // Undefined means no step definition existed and it should fail
            if (stepStatus == "undefined") {
                stepStatus = "failed";
            }

            // one of PASSED (green), FAILED (red), or SKIPPED (yellow)
            stepStatus = stepStatus.toUpperCase();

            // Call the pulse API to update step results
            try {
                console.log("Calling updateStepResults with: " + JSON.stringify(stepSdk) + ", " + stepName + ", " + stepStatus + ", " + issueId + ", " + stepKeyword);
                Steps.updateStepResults(stepSdk, stepName, stepStatus, issueId, stepKeyword);
            }
            catch {
                console.log("Error calling updateStepResults");
            }
        }
    }
}
