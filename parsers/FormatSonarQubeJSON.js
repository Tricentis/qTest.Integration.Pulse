
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

        // Payload to be passed in: json results from SonarQube webhook integration

        var payload = body;
        var testResults = payload.result; 
        var projectId = payload.projectId;
        var cycleId = payload["test-cycle"];
        var requiresDecode = payload.requiresDecode;

        if(requiresDecode == 'true') {
            testResults = JSON.parse(testResults);
        }

        var testLogs = [];

        var moduleName = testResults.project.name;

        console.log(moduleName);

        testResults.qualityGate.conditions.forEach(function(condition) {
            TCStatus = "PASS"; // NOTE: that the automation settings must be mapped with passed vs the default PASS
            var reportingLog = {
                exe_start_date: testResults.analysedAt, // TODO These could be passed in
                exe_end_date: testResults.changedAt,
                module_names: [
                    moduleName
                ],
                name: condition.metric,
                automation_content: testResults.taskId + '#' + moduleName + '#' + condition.metric,
                properties: []                        
            };

            var testStepLogs = [];
                
            var operator = '';
            if(condition.operator == 'LESS_THAN') {
                operator = ' > ';
            }
            if(condition.operator == 'GREATER_THAN') {
                operator = ' < ';
            }

            var description = condition.metric;
            var expected = operator + condition.errorThreshold;
            var actual = condition.value;
            var status = condition.status;

            if(status == 'ERROR') {
                TCStatus = 'FAIL';
                status = 'FAIL';
            }
            if(status == 'OK') {
                TCSTatus = 'PASS';
                status = 'PASS';
            }

            var stepLog = {
                order: 1,
                description: description,
                expected_result: expected,
                actual_result: actual,
                status: status
            };
            
            testStepLogs.push(stepLog);

            reportingLog.description = testResults.project.name;
            reportingLog.status = TCStatus;
            reportingLog.test_step_logs = testStepLogs;
            reportingLog.featureName = condition.metric;
            testLogs.push(reportingLog);
        })

        var formattedResults = {
            "projectId" : projectId,
            "test-cycle" : cycleId,
            "logs" : testLogs
        };

        emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { ResultsFormatSuccess: "Results formatted successfully for project " + constants.JenkinsJobName }); 
        emitEvent('<INSERT NAME OF UPDATEQTEST/SCENARIO RULE HERE>', formattedResults );
}
