const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');
const ScenarioSdk = require('@qasymphony/scenario-sdk');

console.log("Starting Link Requirements Action");
    
exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }
    var payload = body;

    var testLogs = payload.logs;
    var projectId = payload.projectId;

    var standardHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${constants.QTEST_TOKEN}`,
        'x-scenario-project-id': constants.ScenarioProjectID
    }

    const options = {
        url: constants.ScenarioURL + '/api/features',
        method: 'GET',
        headers: standardHeaders
    };

    var features;
    request.get(options, function (optserr, optsresponse, resbody) {
        if (optserr) {
            console.log("Problem Getting Feature List: " + optserr);
        }
        else {
            console.log("Got Features List: " + resbody);
            features = JSON.parse(resbody);
            LinkRequirements();
        }
    });
    
    // This makes a best effort to link if test cases exist. Not if you just uploaded via the auto-test-logs endpoint, the job is batched and may not be completed yet
    function LinkRequirements() {
        testLogs.forEach(function (testcase) {
        
        // var matchingFeature = features.find(x => x.name === testcase.featureName);

        var matchingFeatures = features.filter(feature => feature.name === testcase.featureName);

        if (matchingFeatures.length === 0) {
            return
        }

        // if(!matchingFeature)
        //     return;

        matchingFeatures.forEach(function (matchingFeature) {             
            var reqopts = getReqBody(matchingFeature.issueKey);
            request.post(reqopts, function (err, response, featureResBody) {

                if (err) {
                    console.log("Problem getting requirement: " + err );
                }
                else {
                    if (featureResBody.items.length === 0) { // No corresponding feature exists in scenario
                        console.log('[Info] No featureResBody item found')
                        return;
                    }

                    var reqid = featureResBody.items[0].id;
                    var tcopts = getTCBody(testcase.name);

                    request.post(tcopts, function (tcerr, tcresponse, testCaseResBody) {

                        if (tcerr) {
                            console.log("Problem getting test case: " + err );
                        }
                        else {
                            if(testCaseResBody.items.length === 0) { // Test Case Doesn't yet exist - we'll try this another time
                                console.log('[Info] No testCaseResBody item found')
                                console.log(tcresponse);
                                return;
                            }

                            var tcid = testCaseResBody.items[0].id;
                            var linkopts = getLinkBody(reqid, tcid);

                            request.post(linkopts, function (optserr, optsresponse, resbody) {
                                if (optserr) {
                                    console.log('[Error] A link is failed to be added.', optserr)
                                    console.log("Problem creating test link to requirement: " + err);
                                }
                                else {
                                    // Success, we added a link!
                                    console.log('[Info] A link is added')
                                    console.log("link added for TC: " + testcase.name + " to requirement " + matchingFeature.issueKey);
                                }
                            });
                        }
                    });
                }
            });
         })

    });

    }

    function getTCBody(TCName) {
        return {
            url: "https://" + constants.ManagerURL + "/api/v3/projects/" + projectId + "/search",
            json: true,
            headers: standardHeaders,
            body: {
                "object_type": "test-cases",
                "fields": [
                    "*"
                ],
                "query": "Name = '" + TCName + "'"
            }
        };
    }

    function getReqBody(key) {
        return {
            url: "https://" + constants.ManagerURL + "/api/v3/projects/" + projectId + "/search",
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
            url: "https://" + constants.ManagerURL + "/api/v3/projects/" + projectId + "/requirements/" + reqid + "/link?type=test-cases",
            json: true,
            headers: standardHeaders,
            body: [
                tcid
            ]
        };
    }
}
