# Pulse Invocation Reconciliation

An HTTP `5xx` from `Webhooks.invoke(...)` does not prove that Pulse failed to
create the downstream execution. The gateway can accept the Trigger and start
its Actions, then fail while returning execution metadata to the caller. Treat
this as `CHILD_EXECUTION_STATUS_UNKNOWN`, not as permission to retry.

## Reconciliation Procedure

1. Copy the `correlationId`, parent Pulse execution id, timestamp, downstream
   Trigger name, and HTTP status from the parser error log.
2. Open the downstream Action's Pulse execution list and inspect executions at
   the same timestamp.
3. Search stdout or payload details for the same `correlationId`.
4. If `UpdateQTestWithResults` ran, record its Pulse execution id, qTest queue
   id, HTTP status, and target object. Do not resubmit the delivery.
5. Inspect `CheckProcessingQueue` or the destination Test Cycle/Test Suite to
   confirm whether qTest completed processing.
6. Resubmit only when no matching downstream execution, qTest queue, or qTest
   result exists.

## Logging Contract

Ambiguous invocation errors log the following without logging the emitted
results themselves:

- `correlationId` and downstream event name;
- `errorCode=CHILD_EXECUTION_STATUS_UNKNOWN`;
- `httpStatus`, when available;
- `invocationOutcome=unknown`;
- `automaticRetry=disabled`;
- `reconciliationRequired=true`; and
- serialized emitted-payload size in bytes.

Pulse may omit or lose stdout during a gateway failure. The same essential
context is therefore repeated in the structured stderr entry emitted by the
calling rule's catch path.
