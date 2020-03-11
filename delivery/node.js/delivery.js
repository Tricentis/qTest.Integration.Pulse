/*
 * Notes for Automation Host 2.3.2 and earlier:
 * This script currently requires the 'request' and 'uuid' node.js modules
 * to be manually copied to the host installation directory:
 * Ex: C:\[host directory]\build\qautomation\runner\node_modules
 * Uncommenting the next line determines where the host is looking for node modules:
 */

// console.log(module.paths);

const fs = require('fs');
const path = require('path');
const request = require('request'); // dependent upon 'uuid'

const pulseUri = '';                // Pulse parser webhook endpoint
const projectId = '';               // target qTest Project ID
const cycleId = '';                 // target qTest Test Cycle ID

var result = '';

let resultsPath = 'C:\\path\\to\\results\\filename.ext';

try {
	result = fs.readFileSync(resultsPath, 'utf8');
    console.log('Read file successfully.');    
} catch(e) {
    console.log('Error: ', e.stack);
}

let buff = new Buffer(result);
let base64data = buff.toString('base64');

var opts = {
    url: pulseUri,
    json: true,
    body: {
    	projectId: projectId,
        testcycle: cycleId,
        result: base64data
    }
};

return request.post(opts, function (err, response, resbody) {
    if (err) {
        Promise.reject(err);
    }
    else {
        //console.log(response);
        //console.log(resbody);
        Promise.resolve("Uploaded results successfully.");
    }
});