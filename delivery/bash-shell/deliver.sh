#!/bin/bash

cd "<ENTER YOUR RESULTS DIRECTORY HERE>" # CHANGE THIS TO POINT TO YOUR CUCUMBER RESULTS FILE

echo '{ "test-cycle" : <ENTER YOUR QTEST TEST CYCLE ID HERE>, "result" : ' > payload.json
cat <ENTER YOUR RESULTS FILENAME HERE> >> payload.json
echo ', "projectId" : <ENTER YOUR QTEST PROJECT ID HERE> }' >> payload.json


curl -X POST \
 <ENTER YOUR PULSE PARSER WEBHOOK URL HERE> \
 -H 'cache-control: no-cache' \
 -H 'content-type: application/json' \
 -d @payload.json
