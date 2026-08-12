## Summary

<!-- What end-user or maintenance outcome does this change provide? -->

## Contract and compatibility impact

<!--
List changes to event payloads, schema versions, Constants, Trigger names,
provider APIs, return values, error codes, or supported runtimes. State "None"
when the change is internal/documentation-only.
-->

## Migration or deployment steps

<!-- Explain how an existing Pulse project should adopt the change. -->

## Validation performed

<!-- Include `npm run validate` and any sanitized live-provider smoke test. -->

- [ ] `npm run validate` passes.
- [ ] A live provider/qTest smoke test was performed, or the reason it was not
      required/possible is explained below.

## Security and operational review

- [ ] No credentials, signed URLs, customer data, or private hostnames appear in
      source, fixtures, screenshots, logs, or commit history.
- [ ] External requests use bounded timeouts and safe error normalization.
- [ ] Non-idempotent operations are not automatically retried after an
      ambiguous response.
- [ ] Logs include useful correlation/stage context without complete payloads or
      secret-like fields.

## Documentation checklist

- [ ] Every added or changed rule begins with an accurate usage block.
- [ ] Required Constants, Trigger wiring, inputs, outputs, and limitations are
      documented.
- [ ] The owning directory README and main README are updated when applicable.
- [ ] External links use authoritative provider documentation.
- [ ] Breaking/deprecated behavior includes an explicit migration note.

## Change type

- [ ] Bug fix
- [ ] Compatible enhancement
- [ ] New integration or parser
- [ ] Documentation or test maintenance
- [ ] Breaking change

## Related issue

<!-- Use "Closes #..." when appropriate. -->
