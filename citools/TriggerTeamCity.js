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

    var buildCode = constants.TeamCityBuildCode

    console.log(buildCode)

    var dataString = '<build><buildType id="' + buildCode + '"/></build>';

    console.log(dataString)

    var opts = {
        url: url,
        method: 'POST',
        headers: headers,
        body: dataString,
    };

    request.post(opts, function(err, res, bd) {
            if(!err) {
                emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { TeamCityTriggerSuccess: "TeamCity Build just kicked off for: " + buildCode });
            }
            else {
                emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { TeamCityProject: "Unexpected Error Triggering TeamCity Build: " + buildCode});
            }
    });

}
