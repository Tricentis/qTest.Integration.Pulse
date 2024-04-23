const cp = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// This function checks the size of the payload
const formatSizeUnits = async (bytes) => {
    if (bytes > 0) {
        bytes = (bytes / 1048576).toFixed(4); 
    } else {
        bytes = 0;
    }
    return bytes;
}

// And this function executes a CLI command if needed
const execCommand = async (command) => {
    console.log('=== [INFO] executing command: ', command, ' ===');
    cp.execSync(command, {stdio: 'inherit'});
    console.log('=== [INFO] execution completed ===');
}

// And this function does all the things
const main = async () => {
    // Configuration Section
    const pulseUri = '';                // Pulse parser webhook endpoint
    const projectId = '';               // Target qTest Project ID
    const cycleId = '';                 // Target qTest Test Cycle ID
    const command = '';                 // CLI execution command, leave empty if not required
    // Edit this to reflect your results file, be certain to escape the slashes as seen below
    const resultsPath = 'C:\\path\\to\\results\\filename.ext';
    // End Configuration Section

    // Execution section, will skip if 'command' is empty string ''
    if (command !== '') {
        try {
            execCommand(command);
        } catch(e) {
            console.log('=== [ERROR] ', e.stack, ' ===');
            process.exit(1);
        }
    }

    // Read the results file
    let result = '';
    try {
        result = await fs.readFile(resultsPath, 'utf8');
        console.log('=== [INFO] read results file successfully ===');
    } catch(e) {
        console.log('=== [ERROR] ', e.stack, ' ===');
        process.exit(1);
    }

    // Add a bit of *spice*
    let buff = Buffer.from(result);
    let base64data = buff.toString('base64');

    let payloadBody = {
        'projectId': projectId,
        'testcycle': cycleId,
        'result': base64data
    };

    // Check the payload size to make sure it'll fit, needs to be <=50MB
    let bufferSize = await formatSizeUnits(Buffer.byteLength(JSON.stringify(payloadBody), 'utf8'));

    console.log('=== [INFO] payload size is ' + bufferSize + ' MB ===');
    if (bufferSize > 50) {
        console.log('=== [ERROR] payload size is greater than 50 MB cap ===');
        process.exit(1);
    }

    // Establish the options for the webhook post to Pulse parser
    try {
        console.log('=== [INFO] uploading results... ===');
        const response = await axios.post(pulseUri, payloadBody);
        for (let r = 0; r < response.data.length; r++) {
            console.log('=== [INFO] status: ' + response.data[r].status + ', execution id: ' + response.data[r].id + ' ===');
        }
        console.log('=== [INFO] uploaded results successfully ===');
    } catch (err) {
        console.log('=== [ERROR] ' + err + ' ===');
        process.exit(1);
    }
};

main();