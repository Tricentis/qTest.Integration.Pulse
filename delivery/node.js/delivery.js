const cp = require('child_process');
// This script requires the 'request' node.js module.
// This section grabs required node modules not packaged with
// the Automation Host service prior to executing the script.
const req = async module => {
  try {
    require.resolve(module);
  } catch (e) {
    console.log(`=== could not resolve "${module}" ===\n=== installing... ===`);
    cp.execSync(`npm install ${module}`);
    await setImmediate(() => {});
    console.log(`=== "${module}" has been installed ===`);
  }
  console.log(`=== requiring "${module}" ===`);
  try {
    return require(module);
  } catch (e) {
    console.log(`=== could not include "${module}" ===`);
    process.exit(1);
  }
}

const main = async () => {

    const { execSync } = await req("child_process");
    const fs = await req('fs');
    const path = await req('path');
    const request = await req('request');
    
    const pulseUri = '';                // Pulse parser webhook endpoint
    const projectId = '';               // target qTest Project ID
    const cycleId = '';                 // target qTest Test Cycle ID
    
    var result = '';
    
    
    // Build command line for test execution.  Place any scripts surrounding build/test procedures here.
    // Comment out this section if build/test execution takes place elsewhere.
    let command = '';
    
    console.log(`=== executing command ===`);
    console.log(command);
    execSync(command, {stdio: "inherit"});
    console.log(`=== command completed ===`);
    // Build section end.

    
    // Edit this to reflect your results file, be certain to escape the slashes as seen below.
    let resultsPath = 'C:\\path\\to\\results\\filename.ext';
    
    try {
        result = fs.readFileSync(resultsPath, 'ascii');
        console.log('=== read results file successfully ===');
    } catch(e) {
        console.log('=== error: ', e.stack, ' ===');
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
    
    console.log(`=== uploading results... ===`)
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
};

main();
