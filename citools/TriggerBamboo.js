/**
 * Triggers a Bamboo build job using Bamboo REST API.
 * Requires constants "BambooUserName", "BambooPassword", "BambooURL", and "BambooProjectCode" to be defined.
 *
 * trigger: Repository (Bitbucket, Github, Gitlab, etc), Scenario Action
 * call source: other Pulse Actions via emitEvent()
 * payload example: N/A, trigger only
 * constants example:
 *  BambooUserName: admin
 *  BambooPassword: password
 *  BambooURL: bamboo.yourdomain.com:8085
 *  BambooProjectCode: CucumberBuildJob
 * outputs:
 *  The specified build job will be triggered in Bamboo
 */

const axios = require('axios');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function ({ event, constants, triggers }, context, callback) {
  function emitEvent(name, payload) {
    return (t = triggers.find(t => t.name === name)) ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
}

    try {
        const url = `http://${constants.BambooURL}/rest/api/latest/queue/${constants.BambooProjectCode}?stage&executeAllStages&customRevision&os_authType=basic`;
        const auth = {
            username: constants.BambooUserName,
            password: constants.BambooPassword
        };
        await axios.post(url, null, { auth });
        console.log(`[INFO]: Bamboo Build just kicked off for this plan: ${constants.BambooProjectCode}`);
        emitEvent('ChatOpsEvent', { message: `[INFO]: Bamboo Build just kicked off for this plan: ${constants.BambooProjectCode}` });
    } catch (error) {
        console.error(`[ERROR]: Bamboo Build failed to kick off for this plan: ${constants.BambooProjectCode}`, error);
        emitEvent('ChatOpsEvent', { message: `[ERROR]: Bamboo Build failed to kick off for this plan: ${constants.BambooProjectCode}` });
    }
};
