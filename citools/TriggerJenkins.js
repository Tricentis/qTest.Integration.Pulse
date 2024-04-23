/**
 * Triggers a Jenkins build job using Jenkins API.
 * Requires constants "JenkinsUserName", "JenkinsAPIToken", "JenkinsURL", "JenkinsJobName", and "JenkinsJobToken" to be defined.
 *
 * trigger: Repository (Bitbucket, Github, Gitlab, etc), Scenario Action
 * call source: other Pulse Actions via emitEvent()
 * payload example: N/A, trigger only
 * constants example:
 *  JenkinsUserName: admin
 *  JenkinsAPIToken: fa96ad2f-5e1c-4562-a14d-98a94ba9bab1
 *  JenkinsURL: jenkins.yourdomain.com:8080
 *  JenkinsJobName: CucumberBuildJob
 *  JenkinsJobToken: fa96ad2f-5e1c-4562-a14d-98a94ba9bab1
 * outputs:
 *  The specified build job will be triggered in Jenkins
 */

const axios = require('axios');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        return (t = triggers.find(t => t.name === name)) ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    try {
        const url = `http://${constants.JenkinsUserName}:${constants.JenkinsAPIToken}@${constants.JenkinsURL}/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)`;
        const response = await axios.get(url);

        const crumb = response.data.split(":")[1];
        const joburl = `http://${constants.JenkinsUserName}:${constants.JenkinsAPIToken}@${constants.JenkinsURL}/job/${constants.JenkinsJobName}/build?token=${constants.JenkinsJobToken}`;
        const opts = {
            url: joburl,
            method: 'POST',
            headers: {
                "Jenkins-Crumb": crumb
            }
        };

        await axios(opts);
        emitEvent('ChatOpsEvent', { message: `Jenkins Build just kicked off for project: ${constants.JenkinsJobName}` });
    } catch (error) {
        console.error(`[ERROR] Jenkins Build kickoff failed for project: ${constants.JenkinsJobName} & Error: ${error}`);
        emitEvent('ChatOpsEvent', { message: `Jenkins Build kickoff failed for project: ${constants.JenkinsJobName} & Error: ${error}` });
    }
};
