# Pulse Results Delivery Script

The Node.js delivery script reads a JSON, XML, or TRX result file and sends it
to a Pulse parser webhook using delivery contract version 2.

## Requirements

- An Active LTS or Maintenance LTS Node.js release with built-in `fetch` and
  `AbortSignal.timeout`. Node.js 22 or 24 LTS is appropriate at the time of
  this documentation audit; confirm against the
  [Node.js release table](https://nodejs.org/en/about/previous-releases).
- No npm packages or dependency installation are required.

## Configuration

Edit the configuration section in `node.js/delivery.js`:

- `pulseUri`: Pulse parser webhook endpoint.
- `projectId`: target qTest project id.
- `targetType`: `test-cycle` or `test-suite`.
- `targetId`: target qTest Test Cycle or Test Suite id/PID.
- `command`: optional command to run before reading the result file.
- `resultsPath`: path to the generated result file.
- `resultFormat`: `auto`, `json`, or `xml`.

Do not store the configured script in a public repository after inserting a
private Pulse webhook URL. Prefer injecting or replacing deployment-specific
configuration in the CI workspace.

When `resultFormat` is `auto`, the script checks the file extension first:

- `.json` is JSON.
- `.xml` and `.trx` are XML.

For an unrecognized extension, it inspects the first meaningful character.
`{` or `[` indicates JSON; `<` indicates XML. Ambiguous input fails with an
instruction to configure the format explicitly.

## Delivery Contract

JSON is validated and sent as a native JSON object or array:

```json
{
  "deliverySchemaVersion": 2,
  "correlationId": "delivery-generated-uuid",
  "projectId": "123",
  "targetType": "test-cycle",
  "targetId": "456",
  "testcycle": "456",
  "resultFormat": "json",
  "resultEncoding": "identity",
  "result": {}
}
```

XML and TRX are Base64-encoded directly from the original file bytes. This
example selects a Test Suite:

```json
{
  "deliverySchemaVersion": 2,
  "correlationId": "delivery-generated-uuid",
  "projectId": "123",
  "targetType": "test-suite",
  "targetId": "TS-456",
  "testsuite": "TS-456",
  "resultFormat": "xml",
  "resultEncoding": "base64",
  "result": "PHRlc3RzdWl0ZT4uLi48L3Rlc3RzdWl0ZT4="
}
```

Every delivery contains the canonical `targetType` and `targetId` fields plus
exactly one backward-compatible parser field:

- `test-cycle` adds `testcycle` and never `testsuite`.
- `test-suite` adds `testsuite` and never `testcycle`.

All current parser sources forward the selected destination to the unified
`UpdateQTestWithResults` rule, await its required execution, preserve the
correlation id, and log every returned child Pulse execution id and status.

The Node delivery script generates a new `correlationId` for every upload and
includes it in response logging. Parsers and downstream qTest rules should
preserve this value so one delivery can be traced through its Pulse execution
ids and qTest processing queue id. Do not reuse the correlation id as an
idempotency key.

A successful delivery response means Pulse accepted the parser webhook. The
parser, result-submission Action, and qTest processing queue continue
asynchronously and may still fail. Use the returned Pulse execution id and the
`correlationId` to trace the complete workflow.

Pulse `5xx` errors from `Webhooks.invoke(...)` are ambiguous: Pulse may have
created the downstream execution before its gateway response failed. The rules
do not retry these calls automatically. Follow the
[Pulse invocation reconciliation procedure](../docs/PULSE_INVOCATION_RECONCILIATION.md)
before deciding whether to resubmit results.

Base64 prevents XML content from interacting with JSON serialization and
preserves the original result-file bytes. It is an encoding mechanism, not a
security control. Use HTTPS and protect the Pulse webhook URL to secure
delivery.

The four delivery-fed JSON parsers accept both contract version 2 and the
legacy unversioned Base64 envelope. Existing XML parsers remain compatible
because their `result` field is still Base64.

`SonarQubeJSON.js` is not part of this delivery contract; it receives a direct
SonarQube webhook.

## Exit behavior

The script exits unsuccessfully when the optional command fails, the result
file cannot be read or classified, JSON cannot be parsed, the serialized
envelope exceeds 50 MiB, the request times out, or Pulse returns a non-`2xx`
response. It does not install missing packages or retry an ambiguous upload.

Treat the parser webhook URL as a secret. Delivery must use HTTPS; Base64 does
not provide confidentiality or integrity.
