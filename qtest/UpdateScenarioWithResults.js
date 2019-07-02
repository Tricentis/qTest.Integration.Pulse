const ScenarioSdk = require('@qasymphony/scenario-sdk');

const StepSdk = {
    getStepSdk(qtestToken, scenarioProjectId) {
        return new ScenarioSdk.Steps({ qtestToken, scenarioProjectId });
    }
}

const Steps = {
    updateStepResults(stepSdk, name, status) {
        return stepSdk.getSteps(`"${name}"`).then(steps => Promise.all(steps.map(step => stepSdk.updateStep(step.id, Object.assign(step, { status })))));
    }
};

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    var payload = body;
    var testLogs = payload.logs;

    stepSdk = StepSdk.getStepSdk(constants.qTestAPIToken, constants.SCENARIO_PROJECT_ID);
    
    for (var res of testLogs) {
        for (var step of res["test_step_logs"]) {
            var stepName = step.description;
            var stepStatus = step.status;

            // Undefined means no step definition existed and it should fail
            if (stepStatus == "undefined") {
                stepStatus = "failed";
            }

            // one of PASSED (green), FAILED (red), or SKIPPED (yellow)
            stepStatus = stepStatus.toUpperCase();

            // Call the pulse API to update step results
            Steps.updateStepResults(stepSdk, stepName, stepStatus);
        }
    }
}
