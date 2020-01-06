$url = '<ENTER YOUR PARSER PULSE WEBHOOK HERE>'

Set-Location -Path "<ENTER YOUR RESULTS DIRECTORY HERE>"

$payload = (Get-Content "<ENTER YOUR RESULTS FILE NAME HERE>" -Raw)

$body = @{
 'projectId' = '<ENTER YOUR QTEST PROJECT ID HERE>'
 'testcycle' = '<ENTER YOUR QTEST TEST CYCLE ID HERE>'
 'requiresDecode' = 'true'
 'result' = $payload
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-RestMethod -Body $body -Method 'Post' -Uri $url
