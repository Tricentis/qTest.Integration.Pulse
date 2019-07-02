const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

exports.handler = async function({ event, constants, triggers }, context, callback) {
  var bambooProjectCode = body.commits[0].message;

  //Either place project code in constants or pass in an argument from the GitHub payload
  // var url = "http://" + constants.BambooURL + '/rest/api/latest/queue/' + constants.BambooProjectandPlan + '?stage&executeAllStages&customRevision&os_authType=basic';

  var url = "http://" + constants.BambooURL + '/rest/api/latest/queue/' + bambooProjectCode + '?stage&executeAllStages&customRevision&os_authType=basic';


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
              emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { GitPushBambooProject: "Git Push but commit message is not project name code" }); 
          }
          else {
              emitEvent('<INSERT NAME OF CHATOPS INTEGRATION RULE HERE>', { BambooCallSuccess: "Bamboo Build just kicked off for this plan " + bambooProjectCode }); 

          }
  })
}
