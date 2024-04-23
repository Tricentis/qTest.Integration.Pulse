/**
 * Triggers a build job in TeamCity using TeamCity API.
 * Requires constants "TeamCityUserName", "TeamCityPassword", "TeamCityURL", "TeamCityPort", and "TeamCityBuildCode" to be defined.
 *
 * trigger name: Repository (Bitbucket, Github, Gitlab, etc), Scenario Action
 * call source: other Pulse Actions via emitEvent()
 * payload example: N/A, trigger only
 * constants example:
 *  TeamCityUserName: admin
 *  TeamCityPassword: password
 *  TeamCityURL: teamcity.yourdomain.com
 *  TeamCityPort: 8111
 *  TeamCityBuildCode: fa96ad2f
 * outputs:
 *  The specified build job will be triggered in Team City
 */

const axios = require('axios');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function ({ event, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t ? new Webhooks().invoke(t, payload) : console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
    }

    try {
        const url = `http://${constants.TeamCityURL}:${constants.TeamCityPort}/httpAuth/app/rest/buildQueue`;
        const auth = 'Basic ' + Buffer.from(`${constants.TeamCityUserName}:${constants.TeamCityPassword}`).toString('base64');
        const headers = {
            'Content-Type': 'application/xml',
            'Origin': `http://${constants.TeamCityURL}`,
            'Authorization': auth
        };
        const dataString = `<build><buildType id="${constants.TeamCityBuildCode}"/></build>`;

        await axios.post(url, dataString, { headers });
        console.log(`TeamCity Build just kicked off for project: ${constants.TeamCityBuildCode}`);
        emitEvent('ChatOpsEvent', { message: `TeamCity Build just kicked off for: ${constants.TeamCityBuildCode}` });
    } catch (error) {
        console.error(`[ERROR] TeamCity Build failed to kick off for: ${constants.TeamCityBuildCode} & Error: ${error}`);
        emitEvent('ChatOpsEvent', { message: `TeamCity Build failed to kick off for: ${constants.TeamCityBuildCode} & Error: ${error}` });
    }
};