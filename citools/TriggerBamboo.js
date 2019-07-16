const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

exports.handler = async function({ event, constants, triggers }, context, callback) {

  var url = "http://" + constants.BambooURL + '/rest/api/latest/queue/' + constants.bambooProjectCode + '?stage&executeAllStages&customRevision&os_authType=basic';

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
              emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { GitPushBambooProject: "Git Push but commit message is not project name code: " + constants.bambooProjectCode}); 
          }
          else {
              emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { BambooCallSuccess: "Bamboo Build just kicked off for this plan: " + constants.bambooProjectCode }); 

          }
  })
}
