import base64
import sys
import requests

url = '<ENTER YOUR PARSER PULSE WEBHOOK HERE>'

file = open('<ENTER YOUR RESULTS FILE NAME HERE>','r')
if file.mode == "r":
	content = file.read()
	content_bytes = content.encode('ascii')
	file.close
else:
	print('Error reading file.')
	sys.exit(1)

base64_bytes = base64.b64encode(content_bytes)
base64_content = base64_bytes.decode('ascii')

body = {
 'projectId': '<ENTER YOUR QTEST PROJECT ID HERE>',
 'testcycle': '<ENTER YOUR QTEST TEST CYCLE ID HERE>',
 'result': base64_content
}

headers = {
	'Content-Type': 'application/json'
}

with requests.Session() as session:
    response = session.post(url, headers=headers, json=body)
    print(response)

sys.exit(0)