// Payload to be passed in: Cucumber 1.1 for Java JSON test results
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

        var payload = body;
        var projectId = payload.projectId;
        var cycleId = payload.testcycle;

        let testResults = JSON.parse(Buffer.from(payload.result, 'base64').toString('ascii'));

        var testLogs = [];

        testResults.forEach(function(feature) {
            var featureName = feature.name;
            var scenario = "";
            var testCaseId = "";
            feature.elements.forEach(function(testCase) {
                
                if(!testCase.name)
                    testCase.name = "Unnamed";
                
                TCStatus = "passed"; // NOTE: that the automation settings must be mapped with passed vs the default PASS
                // customization for Cucumber 1.1
                if(!testCase.id) {
                    scenario = ((feature.name + ";" + testCase.name).replace(" ", "-")
                    .match(/\d+\.\d+|\d+\b|\d+(?=\w)/g) || [] )
                    .map(function (v) {return +v;});
                    testCaseId = (feature.name + ";" + testCase.name).replace(" ", "-");
                }
                else { 
                    scenario = ( testCase.id
                    .match(/\d+\.\d+|\d+\b|\d+(?=\w)/g) || [] )
                    .map(function (v) {return +v;});
                    testCaseId = testCase.id;
                }
                // folder names
                var foldernames = feature.uri.split("/");
                var currentfolder = foldernames[4];
                // end folder names
                // end customization
                var propertyArr = [];
                var reportingLog = {
                    exe_start_date: new Date(), // TODO These could be passed in
                    exe_end_date: new Date(),
                    module_names: [
                        currentfolder,
                        featureName
                    ],
                    name: scenario.length === 0 ? testCase.name : testCase.name + "  #" + scenario[0],
                    automation_content: feature.uri + "#" + testCase.name + "#" + testCaseId, // + ":" + testCase.steps[0].name
                    properties: propertyArr                        
                };

                var testStepLogs = [];
                order = 0;
                stepNames = [];
                attachments = [];
                
                testCase.steps.forEach(function(step) {
                    stepNames.push(step.name);

                    var status = step.result.status;
                    var actual = step.name;

                    if(TCStatus == "passed" && status == "skipped") {
                        TCStatus = "skipped";
                    }
                    if(status == "failed") {
                        TCStatus = "failed";
                        actual = step.result.error_message;
                    }
                    if(status == "undefined") {
                        TCStatus = "failed";
                        status = "failed";
                    }

                    // Are there an attachment for this step?
                    if("embeddings" in step) {
                        console.log("Has attachment");
                        
                        attCount = 0;
                        step.embeddings.forEach(function(att) {
                            attCount++;
                            var attachment = {
                                name: step.name + " Attachment " + attCount,
                                "content_type": att.mime_type,
                                data: att.data
                            };
                            console.log("Attachment: " + attachment.name)
                            
                            attachments.push(attachment);
                        });
                    }
                    
                    var expected = step.keyword + " " + step.name;
                    
                    if("location" in step.match) {
                        expected = step.match.location;
                    }

                    var stepLog = {
                        order: order,
                        description: step.name,
                        expected_result: step.keyword,
                        actual_result: actual,
                        status: status
                    };
                    
                    testStepLogs.push(stepLog);
                    order++;
                });

                reportingLog.attachments = attachments;
                reportingLog.description = stepNames.join("<br/>");
                reportingLog.status = TCStatus;
                reportingLog.test_step_logs = testStepLogs;
                reportingLog.featureName = featureName;
                testLogs.push(reportingLog);
            });
        });

        var formattedResults = {
            "projectId" : projectId,
            "testcycle": cycleId,
            "logs" : testLogs
        };

        emitEvent('UpdateQTestWithFormattedResults', formattedResults );
}
