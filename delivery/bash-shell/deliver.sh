#!/bin/bash

cd "<ENTER YOUR RESULTS DIRECTORY HERE>" # CHANGE THIS TO POINT TO YOUR JSON RESULTS FILE DIRECTORY

logs=$(base64 -w 0 <ENTER YOUR RESULT FILE NAME HERE>)

echo -n '{ "testcycle" : <ENTER YOUR QTEST TEST CYCLE ID HERE>, "result" : "' > payload.json
echo -n $logs >> payload.json
echo -n '", "projectId" : <ENTER YOUR QTEST PROJECT ID HERE> }' >> payload.json

curl -X POST \
 <ENTER YOUR PULSE PARSER WEBHOOK URL HERE> \
 -H 'cache-control: no-cache' \
 -H 'content-type: application/json' \
 -d @payload.json
