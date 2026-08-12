/**
 * Pulse usage: Legacy Jira-to-qTest helper. Connect a filtered Jira issue
 * webhook Trigger to this Action to create a basic qTest Test Case.
 * Input: Jira webhook JSON containing issue.key.
 * Constants: QTEST_TOKEN, ManagerURL, and ProjectID.
 * Triggers: LinkRequirement is required to complete association;
 * ChatOpsEvent is optional.
 * Output: Creates a qTest Test Case and emits its id with the Jira issue key.
 * Status: Legacy/reference implementation; see qtest/jira/README.md.
 */

const { Webhooks } = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');


exports.handler = function ({ event: body, constants, triggers }, context, callback) {
  let str = body;

  let standardHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `bearer ${constants.QTEST_TOKEN}`
  }

  function emitEvent(name, payload) {
      let t = triggers.find(t => t.name === name);
      return t && new Webhooks().invoke(t, payload);
  }

  // Get Issue Key from Jira Webhook content
  let issueID = str.issue.key;
  console.log("Newly created Jira Requirement: " + issueID)

  let tcid = "";
  // Create a Test Case in qTest
  request({
        uri: `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/test-cases`,
        method: 'POST',
        headers: standardHeaders,
        json: {
          "name": "TC for Req " + issueID
        }
    }, function (error, response, body) {
      if(error)
        console.log(`ERROR: ${error}`);
      else
        console.log(response);

        emitEvent('ChatOpsEvent', { message: "A new test case was added here: " + response.body.web_url });

        // Get the Test Case Object ID
        tcid = response.body.id;
        console.log(`New TCID: ${tcid} located at ${response.body.web_url}`);

        emitEvent('LinkRequirement', { "tcid": tcid, "issueKey": issueID });
    }
  );
}
