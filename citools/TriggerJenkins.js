/**
 * call source: Repository (Bitbucket, Github, Gitlab, etc), Scenario Action
 * payload example: N/A, trigger only
 * constants:
 *  JenkinsUserName: admin
 *  JenkinsAPIToken: fa96ad2f-5e1c-4562-a14d-98a94ba9bab1
 *  JenkinsURL: jenkins.yourdomain.com:8080
 *  JenkinsJobName: CucumberBuildJob
 *  JenkinsJobToken: fa96ad2f-5e1c-4562-a14d-98a94ba9bab1
 * outputs:
 *  The specified build job will be triggered in Jenkins
 */

const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

        var url = "http://" + constants.JenkinsUserName + ":" + constants.JenkinsAPIToken + "@" + 
        constants.JenkinsURL + '/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)';

        request.get({url:url, insecure: true}, function(err, response, body) {
            if(!err) {
                var crumb = body.split(":")[1];

                var joburl = "http://" + constants.JenkinsUserName + ":" + constants.JenkinsAPIToken + "@" + 
                        constants.JenkinsURL + "/job/" + constants.JenkinsJobName + "/build?token=" + constants.JenkinsJobToken;
                var opts = {
                    url: joburl,
                    insecure: true,
                    contentType: "application/x-www-form-urlencoded; charset=UTF-8",
                    headers: {
                        "Jenkins-Crumb": crumb
                    }
                };

                request.post(opts, function(err, res, bd) {
                    if(!err) {
                        emitEvent('ChatOpsEvent', { message: "Jenkins Build just kicked off for project: " + constants.JenkinsJobName });
                    }
                    else {
                        emitEvent('ChatOpsEvent', { message: "Jenkins Build kickoff failed for project: " + constants.JenkinsJobName + " & Error: " + err });
                    }
                });
            }
            else {
                emitEvent('ChatOpsEvent', { message: "Jenkins Build kickoff failed for project: " + constants.JenkinsJobName + " & Error: " + err  }); 
            }
        });
}
