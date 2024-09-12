const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    try {
        const payload = body;
        const projectId = payload.projectId;
        const cycleId = payload.testcycle;

        const testResults = JSON.parse(Buffer.from(payload.result, 'base64').toString('utf8'));

        const formattedResults = {
            "projectId": projectId,
            "testcycle": cycleId,
            "logs": Array.isArray(testResults) 
                ? testResults.flatMap(parseTestResults) // Process each test result if array
                : parseTestResults(testResults) // Process single test result
        };

        console.log('[INFO]: Allure 2.0 tests successfully parsed.');
        emitEvent('UpdateQTestWithFormattedResultsEvent', formattedResults);
    } catch (error) {
        emitEvent('ChatOpsEvent', { message: 'Error processing Allure 2.0 test results: ' + error });
        console.error(`[ERROR]: Error processing Allure 2.0 test results: ${error}`);
    }

    function convertEpochToISO(timestamp) {
        return new Date(timestamp).toISOString();
    }    

    function parseTestResults(testResults) {
        const { name = "Unnamed Test Case", start, stop, status, statusDetails, steps = [], labels = [] } = testResults;

        console.log(`[INFO]: Processing result: ${name}`);
        
        const testCaseName = name.split('\n')[0] || "Unnamed Test Case";
        const moduleName = [testCaseName.split(':')[0]];
        const testCaseAutomationContent = name.replace(/\n/g, ' ');

        const note = labels.map(label => `${label.name}: ${label.value}`).join('\n');

        let statusDetailsAttachment;
        if (statusDetails) {
            const statusDetailsText = `Message: ${statusDetails.message}\n\nStack Trace: ${statusDetails.trace}`;
            statusDetailsAttachment = {
                name: `statusDetails.txt`,
                data: Buffer.from(statusDetailsText).toString('base64'),
                content_type: 'text/plain'
            };
        }

        const testSteps = steps
            .filter(step => step.name && step.name.trim() !== '')
            .map((step, index) => {
                let description = step.name;
                if (step.parameters && step.parameters.length > 0) {
                    const params = step.parameters.map(param => `${param.name}: ${param.value}`).join(', ');
                    description += ` ${params}`;
                }

                return {
                    description: description,
                    expected_result: description,
                    actual_result: description,
                    exe_date: convertEpochToISO(step.start),
                    status: step.status,
                    order: index + 1
                };
            });

        return [{
            name: testCaseName,
            automation_content: testCaseAutomationContent,
            status: status,
            exe_start_date: convertEpochToISO(start),
            exe_end_date: convertEpochToISO(stop),
            note: note,
            attachments: statusDetailsAttachment ? [statusDetailsAttachment] : [],
            module_names: moduleName,
            test_step_logs: testSteps
        }];
    }
}
