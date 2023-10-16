const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

/*
Goal: Create a weblink in Jira when a requirement is created in qTest. Here is the qTest link example.
    https://yourURL.qtestnet.com/p/PjPjPjPj/portal/project#tab=requirements&object=5&id=idididid
    PjPjPjPj = your projet number
    idididid = the ID of the requisition

Steps to implement:
1 - Create you trigger webhook in pluse (don't forget to select your project in pulse)
2 - Use your prefered API tool to register your webhook to qTest event.
    https://yourURL.qtestnet.com/api/v3/webhooks
Body:
{
  "name": "Your web hook name that you want",
  "url": "your webhook URL",
  "events": [
    "requirement_created" //(the action you want to attach)
  ],
  "secretKey": "I've put my qtest token (not sure what is needed)",
  "responseType": "json",
  "projectIds": [
    //List of project that you want to trigger
    PjPjPjPj
  ]
}

3 - take all this code and put it in your action.
4 - Create your constants
5 - Create your rule and activate it.
*/

/*
API Documentation:
Jira : https://developer.atlassian.com/server/jira/platform/jira-rest-api-for-remote-issue-links/
qTest : https://documentation.tricentis.com/qtest/od/en/content/apis/overview/qtest_api_specification.htm
*/

/* Payload example
{
    "event_timestamp": 1697205726802,
        "event_type": "requirement_created",
            "requirement": {
        "id": idididid,
            "project_id": PjPjPjPj
    }
}
*/


/* List of constants
constants.JiraUrl = YourJiraUrl.atlassian.net
constants.Jira_TOKEN = Info you would put after "'Authorization':" for calling the Jira API

constants.qTestUrl = yourURL.qtestnet.com
constants.qTest_TOKEN = Info you would put after "'Authorization':" for calling the qTest API
*/

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: qTestReq, constants, triggers }, context, callback) {

    var ReqQuerryInfo = getReqQuerry(qTestReq.requirement.id, qTestReq.requirement.project_id);

    request.get(ReqQuerryInfo, function (err, response, body) {
        if (err) {
            console.log('Error: Problem getting requirement: ' + err + '\r\n');
        }
        else {
            if (body.name === undefined) {
                console.log('Error: No requirement found: ' + err + '\r\n');
                return;
            }

            var ReqName = body.name;
            var ReqURL = body.web_url;
            var ReqPID = body.pid
            var ReqJiraID = ReqName.split(" ")[0];

            console.log('ReqURL: ' + ReqURL + '\r\n');
            console.log('ReqName: ' + ReqName + '\r\n');
            console.log('ReqPID: ' + ReqJiraID + '\r\n');
            console.log('ReqJiraID: ' + ReqJiraID + '\r\n');


            var MyJiraUrl = "https://" + constants.JiraUrl + "/rest/api/latest/issue/" + ReqJiraID + "/remotelink";
            console.log('MyJiraUrl: ' + MyJiraUrl + '\r\n');

            request.post({
                url: MyJiraUrl,
                json: true,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': constants.Jira_TOKEN
                },
                body: {
                    "object": {
                        "url": ReqURL,
                        "title": "qTest Requirement: " + ReqPID
                    }
                }
            }, function (err, response, body) {
                if (err) {
                    console.log('Error: Problem inserting link in jira: ' + err + '\r\n');
                }
            });
        }
    });

    function getReqQuerry(Req_ID, Pj_ID) {
        var MyqTestUrl = "https://" + constants.qTestUrl + "/api/v3/projects/" + Pj_ID + "/requirements/" + Req_ID;

        console.log("QtestURL:" + MyqTestUrl + '\n\r');

        return {
            url: MyqTestUrl,
            json: true,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': constants.qTest_TOKEN
            }
        };
    };
};
