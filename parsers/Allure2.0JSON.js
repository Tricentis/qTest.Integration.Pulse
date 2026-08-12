/**
 * Pulse usage: Parses Allure 2 JSON results delivered by delivery.js.
 * Input: Delivery contract v2 native JSON, or the legacy unversioned Base64
 * JSON envelope, plus qTest project and Test Cycle/Test Suite destination.
 * Constants: None.
 * Triggers: UpdateQTestWithResults is required; ChatOpsEvent is optional.
 * Output: Formatted qTest automation logs forwarded to the submission rule.
 * See parsers/README.md and delivery/README.md for wiring and contracts.
 */

import { Webhooks } from "@qasymphony/pulse-sdk";

const RULE_NAME = "Allure2.0JSON";

function parseBase64Json(value) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error("Expected a non-empty Base64 JSON result string.");
    }

    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function readJsonResult(payload) {
    const deliverySchemaVersion =
        payload.deliverySchemaVersion === undefined ? 1 : payload.deliverySchemaVersion;

    if (deliverySchemaVersion === 1) {
        return parseBase64Json(payload.result);
    }

    if (deliverySchemaVersion !== 2) {
        throw new Error(`Unsupported deliverySchemaVersion '${deliverySchemaVersion}'.`);
    }

    if (payload.resultFormat !== "json") {
        throw new Error(`Expected resultFormat 'json', received '${payload.resultFormat}'.`);
    }

    if (payload.resultEncoding === "identity") {
        if (payload.result === null || typeof payload.result !== "object") {
            throw new Error("Identity-encoded JSON result must be an object or array.");
        }

        return payload.result;
    }

    if (payload.resultEncoding === "base64") {
        return parseBase64Json(payload.result);
    }

    throw new Error(`Unsupported JSON resultEncoding '${payload.resultEncoding}'.`);
}

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    const emitEvent = createEventEmitter(triggers, correlationId);

    try {
        const payload = body;
        const projectId = payload.projectId;
        const cycleId = payload.testcycle;
        const testResults = readJsonResult(payload);
        const formattedResults = {
            deliverySchemaVersion: payload.deliverySchemaVersion,
            correlationId: correlationId,
            projectId: projectId,
            targetType: payload.targetType,
            targetId: payload.targetId,
            testcycle: cycleId,
            testsuite: payload.testsuite,
            logs: Array.isArray(testResults)
                ? testResults.flatMap(parseTestResults) // Process each test result if array
                : parseTestResults(testResults), // Process single test result
        };

        writeLog("INFO", "Allure 2.0 results parsed successfully.", {
            correlationId: correlationId,
            stage: "parse",
            parsed: formattedResults.logs.length,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("UpdateQTestWithResults", formattedResults, { required: true });
        return formattedResults;
    } catch (error) {
        writeLog("ERROR", "Unable to process Allure 2.0 results.", {
            correlationId: correlationId,
            stage: "failed",
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            errorMessage: error && error.message,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            message: `[ERROR] correlationId=${correlationId} Unable to process Allure 2.0 results: ${error.message}`,
        });
        throw error;
    }

    function convertEpochToISO(timestamp) {
        return new Date(timestamp).toISOString();
    }

    function parseTestResults(testResults) {
        const { name = "Unnamed Test Case", start, stop, status, statusDetails, steps = [], labels = [] } = testResults;
        console.log(`[INFO]: Processing result: ${name}`);
        console.log("Dates", start, stop);
        const testCaseName = name.split("\n")[0] || "Unnamed Test Case";
        const moduleName = [testCaseName.split(":")[0]];
        const testCaseAutomationContent = name.replace(/\n/g, " ");
        const note = labels !== "" ? labels.map((label) => `${label.name}: ${label.value}`).join("\n") : "No labels";

        let statusDetailsAttachment;
        if (statusDetails) {
            const statusDetailsText = `Message: ${statusDetails.message}\n\nStack Trace: ${statusDetails.trace}`;
            statusDetailsAttachment = {
                name: `statusDetails.txt`,
                data: Buffer.from(statusDetailsText).toString("base64"),
                content_type: "text/plain",
            };
        }
        const testSteps =
            steps !== ""
                ? steps
                      .filter((step) => step.name && step.name.trim() !== "")
                      .map((step, index) => {
                          let description = step.name;
                          if (step.parameters && step.parameters.length > 0) {
                              const params = step.parameters.map((param) => `${param.name}: ${param.value}`).join(", ");
                              description += ` ${params}`;
                          }

                          return {
                              description: description,
                              expected_result: description,
                              actual_result: description,
                              exe_date: convertEpochToISO(step.start),
                              status: step.status,
                              order: index + 1,
                          };
                      })
                : "No steps";

        return [
            {
                name: testCaseName,
                automation_content: testCaseAutomationContent,
                status: status,
                exe_start_date: convertEpochToISO(start),
                exe_end_date: convertEpochToISO(stop),
                note: note,
                attachments: statusDetailsAttachment ? [statusDetailsAttachment] : [],
                module_names: moduleName,
                test_step_logs: testSteps,
            },
        ];
    }
};

function createEventEmitter(triggers, correlationId) {
    return async function emitEvent(name, payload, options) {
        const required = Boolean(options && options.required);
        const trigger = (triggers || []).find((candidate) => candidate.name === name);

        if (!trigger) {
            const error = createParserError("TRIGGER_NOT_FOUND", `Webhook named '${name}' was not found.`);
            writeLog(required ? "ERROR" : "WARN", error.message, {
                correlationId: correlationId,
                stage: "emit",
                event: name,
                errorCode: error.code,
            });
            if (required) throw error;
            return [];
        }

        writeLog("INFO", "Invoking downstream Pulse event.", {
            correlationId: correlationId,
            stage: "emit",
            event: name,
            emittedPayloadBytes: getJsonByteLength(payload),
        });

        try {
            const response = await new Webhooks().invoke(trigger, payload);
            const executions = normalizePulseExecutions(response);
            if (executions.length === 0) {
                const unknownError = createUnknownPulseInvocationError(name);
                if (required) throw unknownError;
                writeLog("WARN", unknownError.message, Object.assign({
                    correlationId: correlationId,
                    stage: "emit",
                    event: name,
                }, getPulseInvocationLogFields(unknownError, payload)));
                return [];
            }
            executions.forEach((execution) => {
                writeLog("INFO", "Downstream Pulse execution created.", {
                    correlationId: correlationId,
                    stage: "emit",
                    event: name,
                    childExecutionId: execution && execution.id,
                    childExecutionStatus: execution && execution.status,
                });
            });
            return executions;
        } catch (error) {
            const wrapped = error && error.code === "CHILD_EXECUTION_STATUS_UNKNOWN"
                ? error
                : createPulseInvocationError(name, error);
            writeLog(required ? "ERROR" : "WARN", wrapped.message, Object.assign({
                correlationId: correlationId,
                stage: "emit",
                event: name,
            }, getPulseInvocationLogFields(wrapped, payload)));
            if (required) throw wrapped;
            return [];
        }
    };
}

function normalizePulseExecutions(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
}

function getCorrelationId(value) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    return require("crypto").randomUUID();
}

function createParserError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function createUnknownPulseInvocationError(name) {
    const error = createParserError(
        "CHILD_EXECUTION_STATUS_UNKNOWN",
        `Pulse returned no execution metadata for downstream event '${name}'. ` +
            "The child may have been created; reconcile by correlationId before retrying."
    );
    error.invocationOutcome = "unknown";
    error.automaticRetry = "disabled";
    error.reconciliationRequired = true;
    return error;
}

function createPulseInvocationError(name, cause) {
    const httpStatus = getHttpStatus(cause);
    const ambiguous = httpStatus >= 500 && httpStatus <= 599;
    const error = createParserError(
        ambiguous ? "CHILD_EXECUTION_STATUS_UNKNOWN" : "CHILD_EXECUTION_FAILED",
        ambiguous
            ? `Pulse returned HTTP ${httpStatus} while invoking downstream event '${name}'. ` +
                "The child may have been created; reconcile by correlationId before retrying."
            : `Unable to invoke downstream Pulse event '${name}'.`,
        cause
    );
    error.httpStatus = httpStatus;
    error.invocationOutcome = ambiguous ? "unknown" : "failed";
    error.automaticRetry = "disabled";
    error.reconciliationRequired = ambiguous;
    return error;
}

function getPulseInvocationLogFields(error, payload) {
    const cause = error && error.cause;
    return {
        errorCode: error && error.code,
        errorMessage: sanitizeLogText(cause && cause.message ? cause.message : error && error.message),
        httpStatus: error && error.httpStatus,
        invocationOutcome: error && error.invocationOutcome,
        automaticRetry: error && error.automaticRetry,
        reconciliationRequired: error && error.reconciliationRequired,
        emittedPayloadBytes: getJsonByteLength(payload),
    };
}

function getHttpStatus(error) {
    const explicitStatus =
        (error && error.response && (error.response.status || error.response.statusCode)) ||
        (error && (error.statusCode || error.status));
    const parsedStatus = Number(explicitStatus);
    if (Number.isInteger(parsedStatus)) return parsedStatus;
    const match = String((error && error.message) || "").match(/\b([45]\d{2})\b/);
    return match ? Number(match[1]) : undefined;
}

function getJsonByteLength(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch (error) {
        return undefined;
    }
}

function sanitizeLogText(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/(bearer\s+)[^\s,;"']+/gi, "$1[REDACTED]")
        .replace(/([?&](?:sig|token|api[_-]?key)=)[^&\s"']+/gi, "$1[REDACTED]")
        .replace(
            /\b(authorization|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi,
            "$1=[REDACTED]"
        )
        .slice(0, 500);
}

function writeLog(level, message, fields) {
    const entries = Object.assign({ rule: RULE_NAME }, fields || {});
    const rendered = Object.keys(entries)
        .filter((key) => entries[key] !== undefined && entries[key] !== null && entries[key] !== "")
        .map((key) => `${key}=${JSON.stringify(sanitizeLogText(entries[key]))}`)
        .join(" ");
    const line = `[${level}] ${rendered} message=${JSON.stringify(sanitizeLogText(message))}`;
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
}
