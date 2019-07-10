#!/bin/bash

cd "<ENTER YOUR RESULTS DIRECTORY HERE>"

#Read in file
logs=$(<<ENTER YOUR RESULTS FILENAME HERE>)

curl -X POST \
  <ENTER YOUR PULSE PARSER WEBHOOK URL HERE> \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/json' \
  -d '{
    "projectId" : <ENTER YOUR QTEST PROJECT ID HERE>,
    "test-cycle" : <ENTER YOUR QTEST TEST CYCLE ID HERE>,
    "result" : '"$logs"'
}'
