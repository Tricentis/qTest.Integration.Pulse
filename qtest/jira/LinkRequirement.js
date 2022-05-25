const { Webhooks } = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

//
// Expects the payload to look like this
// {
//   tcid: 12345,
//   issueKey: 'AI-123'
// }
//
exports.handler = function ({ event: body, constants, triggers }, context, callback) {
  function emitEvent(name, payload) {
      let t = triggers.find(t => t.name === name);
      return t && new Webhooks().invoke(t, payload);
  }

  var standardHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `bearer ${constants.QTEST_TOKEN}`
  }

  var reqopts = getReqBody(body.issueKey);
  request.post(reqopts, function (err, response, reqResBody) {

      if (err) {
          emitEvent('ChatOpsEvent', { Error: "Problem getting requirement: " + err });
      }
      else {
          if (reqResBody.items.length === 0)
              return;

          var reqid = reqResBody.items[0].id;
            var linkopts = getLinkBody(reqid, body.tcid);

            request.post(linkopts, function (optserr, optsresponse, resbody) {
                if (optserr) {
                    emitEvent('ChatOpsEvent', { message: "Problem creating test link to requirement: " + err });
                }
                else {
                    // Success, we added a link!
                    emitEvent('ChatOpsEvent', { message: "link added for TC: " + body.tcid + " to requirement " + body.issueKey });
                }
            });
      }
  });

  function getReqBody(key) {
    return {
        url: `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/search`,
        json: true,
        headers: standardHeaders,
        body: {
            "object_type": "requirements",
            "fields": [
                "*"
            ],
            "query": "Name ~ '" + key + "'"
        }
    };
  }

  function getLinkBody(reqid, tcid) {
    return {
        url: `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/requirements/${reqid}/link?type=test-cases`,
        json: true,
        headers: standardHeaders,
        body: [
            tcid
        ]
    };
  }
}
