/**
 * call source: Repository (Bitbucket, Github, Gitlab, etc), Scenario Action
 * payload example: N/A, trigger only
 * constants:
 *  TeamCityUserName: admin
 *  TeamCityPassword: password
 *  TeamCityURL: teamcity.yourdomain.com
 *  TeamCityPort: 8111
 *  TeamCityBuildCode: fa96ad2f
 * outputs:
 *  The specified build job will be triggered in Team City
 */

const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    var url = "http://" + constants.TeamCityURL + ':' + constants.TeamCityPort + '/httpAuth/app/rest/buildQueue';

    console.log(url)

    var auth = 'Basic ' + new Buffer(constants.TeamCityUserName + ':' + constants.TeamCityPassword).toString('base64');

    var headers = {
    'Content-Type': 'application/xml',
    'Origin': 'http://' + constants.TeamCityURL,
    'Authorization': auth
    };

    console.log(headers)
    console.log(constants.TeamCityBuildCode)

    var dataString = '<build><buildType id="' + constants.TeamCityBuildCode + '"/></build>';

    console.log(dataString)

    var opts = {
        url: url,
        method: 'POST',
        headers: headers,
        body: dataString,
    };

    request.post(opts, function(err, res, bd) {
            if(!err) {
                emitEvent('ChatOpsEvent', { message: "TeamCity Build just kicked off for: " + constants.TeamCityBuildCode });
            }
            else {
                emitEvent('ChatOpsEvent', { message: "TeamCity Build failed to kick off for: " + constants.TeamCityBuildCode });
            }
    });

}
