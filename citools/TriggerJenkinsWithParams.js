/**
 * Triggers a Jenkins build job with parameters using Jenkins API.
 * Requires constants "JenkinsUserName", "JenkinsAPIToken", "JenkinsURL", "JenkinsParamJob", and "JenkinsJobToken" to be defined.
 *
 * trigger name: Repository (Bitbucket, Github, Gitlab, etc), Scenario Action
 * call source: other Pulse Actions via emitEvent()
 * payload example: { tag: "tag value" }
 * constants example:
 *  JenkinsUserName: admin
 *  JenkinsAPIToken: fa96ad2f-5e1c-4562-a14d-98a94ba9bab1
 *  JenkinsURL: jenkins.yourdomain.com:8080
 *  JenkinsParamJob: CucumberBuildJob
 *  JenkinsJobToken: fa96ad2f-5e1c-4562-a14d-98a94ba9bab1
 * outputs:
 *  The specified build job with parameters will be triggered in Jenkins
 */

const axios = require('axios');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function ({ event, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    try {
        const payload = event;
        const parameter = payload.tag;
        const crumbUrl = `http://${constants.JenkinsURL}/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)`;
        const crumbResponse = await axios.get(crumbUrl, { auth: { username: constants.JenkinsUserName, password: constants.JenkinsAPIToken } });
        const crumb = crumbResponse.data.split(':')[1];
        const jobUrl = `http://${constants.JenkinsUserName}:${constants.JenkinsAPIToken}@${constants.JenkinsURL}/job/${constants.JenkinsParamJob}/buildWithParameters?token=${constants.JenkinsJobToken}&Tag=${parameter}`;
        const opts = {
            url: jobUrl,
            headers: { "Jenkins-Crumb": crumb },
            auth: { username: constants.JenkinsUserName, password: constants.JenkinsAPIToken }
        };
        await axios.post(opts.url, null, { headers: opts.headers, auth: opts.auth });
        console.log(`Jenkins Build just kicked off for project: ${constants.JenkinsParamJob}`);
        emitEvent('ChatOpsEvent', { message: `Jenkins Build just kicked off for project: ${constants.JenkinsParamJob}` });
    } catch (error) {
        console.error(`[ERROR] Jenkins Build kickoff failed for project: ${constants.JenkinsParamJob} & Error: ${error}`);
        emitEvent('ChatOpsEvent', { message: `Jenkins Build kickoff failed for project: ${constants.JenkinsParamJob} & Error: ${error}` });
    }
};
