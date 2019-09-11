const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

// This is to attach large payloads to a Slack file attachment to bypass 
// the Slack message character limitation as well as the Pulse console.log
// length limitation.  Requires constant "SlackToken" and "SlackChannelID" 
// to be created.  https://api.slack.com/custom-integrations/legacy-tokens

exports.handler = function({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
      let t = triggers.find((t) => t.name === name);
      return t && new Webhooks().invoke(t, payload);
    };

    
    var payload = body;

    //console.log(payload);

    var options = {
        method: 'POST',
        url: 'https://slack.com/api/files.upload',
        formData: {
            enctype: "application/x-www-form-urlencoded",
            token: constants.SlackToken,
            title: 'payload.json',
            filename: 'payload.json',
            filetype: 'javascript',
            channels: constants.SlackChannelID,
            content: JSON.stringify(payload)
        },
    }

    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        console.log(`statusCode: ${response.statusCode}`);
        console.log(JSON.parse(response.body));
    });
}
