exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    var str = body;

    var request = require('request');
    var slack_webhook = constants.SlackWebHook;

    console.log('About to request slack webhook: ', slack_webhook);

    request({
        uri: slack_webhook,
        method: 'POST',
        json: { "text": JSON.stringify(str) }
    }, function (error, response, body) { }
    );
}
