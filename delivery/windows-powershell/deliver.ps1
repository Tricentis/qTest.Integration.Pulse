$url = '<ENTER YOUR PARSER PULSE WEBHOOK HERE>'

$content = Get-Content "<ENTER YOUR RESULTS FILE NAME HERE>" -Raw
$bytes = [System.Text.Encoding]::ASCII.GetBytes($content)
$payload = [System.Convert]::ToBase64String($bytes)

$body = @{
 'projectId' = '<ENTER YOUR QTEST PROJECT ID HERE>'
 'testcycle' = '<ENTER YOUR QTEST TEST CYCLE ID HERE>'
 'result' = $payload
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-RestMethod -Body $body -Method 'Post' -Uri $url