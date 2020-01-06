/**
 * call source: Repository (Bitbucket, Github, Gitlab, etc), Scenario Action
 * payload example: N/A, trigger only
 * constants:
 *  BambooUserName: admin
 *  BambooPassword: password
 *  BambooURL: bamboo.yourdomain.com:8085
 *  BambooProjectCode: CucumberBuildJob
 * outputs:
 *  The specified build job will be triggered in Bamboo
 */

const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

exports.handler = async function({ event, constants, triggers }, context, callback) {

  var url = "http://" + constants.BambooURL + '/rest/api/latest/queue/' + constants.BambooProjectCode + '?stage&executeAllStages&customRevision&os_authType=basic';

  var opts = {
      url: url,
      insecure: true,
      contentType: "application/json; charset=UTF-8",
      auth: {
        "user": constants.BambooUserName,
        "pass": constants.BambooPassword
      }
  }

  request.post(opts, function(err, res, bd) {
          if(err) {
              Promise.reject(err);
              emitEvent('ChatOpsEvent', { message: "Bamboo Build failed to kick off for this plan: " + constants.BambooProjectCode}); 
          }
          else {
              emitEvent('ChatOpsEvent', { message: "Bamboo Build just kicked off for this plan: " + constants.BambooProjectCode }); 

          }
  })
}
