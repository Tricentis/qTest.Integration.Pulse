/**
 * Pulse usage: Parses Cucumber for Java 4+ JSON results delivered by
 * delivery.js. This maintained parser uses the standard qTest result pipeline;
 * it does not perform the historical Scenario requirement-linking workflow.
 * Input: Delivery contract v2 native JSON, or the legacy unversioned Base64
 * JSON envelope, plus qTest project and Test Cycle/Test Suite destination.
 * Constants: None.
 * Triggers: UpdateQTestWithResults is required; ChatOpsEvent is optional.
 * Output: Formatted qTest automation logs forwarded to the submission rule.
 * See parsers/README.md and qtest/scenario/README.md for the two workflows.
 */

import { Webhooks } from "@qasymphony/pulse-sdk";

const RULE_NAME = "CucumberJSON";

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

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    const emitEvent = createEventEmitter(triggers, correlationId);

    try {
        let payload = body;
        let projectId = payload.projectId;
        let cycleId = payload.testcycle;

        let testResults = readJsonResult(payload);

        let testLogs = [];
        let notifications = [];

        testResults.forEach(function (feature) {
            let featureName = feature.name;
            feature.elements.forEach(function (testCase) {
                if (!testCase.name) testCase.name = "Unnamed";

                let TCStatus = "passed";

                let reportingLog = {
                    exe_start_date: new Date(),
                    exe_end_date: new Date(),
                    module_names: [featureName],
                    name: testCase.name,
                    automation_content: feature.uri + "#" + testCase.name,
                };

                let testStepLogs = [];
                let order = 0;
                let stepNames = [];
                let attachments = [];

                testCase.steps.forEach(function (step) {
                    if (step.name !== "") {
                        stepNames.push(step.name);

                        let status = step.result.status;
                        let actual = step.name;

                        if (TCStatus == "passed" && status == "skipped") {
                            TCStatus = "skipped";
                        }
                        if (status == "failed") {
                            TCStatus = "failed";
                            actual = step.result.error_message;
                        }
                        if (status == "undefined") {
                            TCStatus = "skipped";
                            status = "skipped";
                            notifications.push(
                                "Cucumber step result not found: " + step.name + "; marking as skipped."
                            );
                            console.log(
                                `[INFO]: Cucumber Parser - Step result not found: ${step.name}; marking as skipped.`
                            );
                        }
                        if (step.embeddings) {
                            console.log('[INFO]: "Step has screenshot attachment, adding...');

                            let attCount = 0;
                            step.embeddings.forEach(function (att) {
                                attCount++;
                                let attachment = {
                                    name: step.name + " Attachment " + attCount,
                                    content_type: att.mime_type,
                                    data: att.data,
                                };
                                console.log("Attachment: " + attachment.name);

                                attachments.push(attachment);
                            });
                        }

                        let expected = step.keyword + " " + step.name;

                        if (step.match && step.match.location) {
                            expected = step.match.location;
                        }

                        let stepLog = {
                            order: order,
                            description: step.keyword + " " + step.name,
                            expected_result: step.name,
                            actual_result: actual,
                            status: status,
                        };

                        testStepLogs.push(stepLog);
                    }
                    order++;
                });

                reportingLog.attachments = attachments;
                reportingLog.description = stepNames.join("<br/>");
                reportingLog.status = TCStatus;
                reportingLog.test_step_logs = testStepLogs;
                reportingLog.featureName = featureName;
                testLogs.push(reportingLog);
            });
        });

        let formattedResults = {
            deliverySchemaVersion: payload.deliverySchemaVersion,
            correlationId: correlationId,
            projectId: projectId,
            targetType: payload.targetType,
            targetId: payload.targetId,
            testcycle: cycleId,
            testsuite: payload.testsuite,
            logs: testLogs,
        };

        for (const message of notifications) {
            await emitEvent("ChatOpsEvent", { correlationId: correlationId, message: message });
        }
        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            message: "Cucumber results successfully parsed.",
        });
        writeLog("INFO", "Cucumber results parsed successfully.", {
            correlationId: correlationId,
            stage: "parse",
            parsed: testLogs.length,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("UpdateQTestWithResults", formattedResults, { required: true });
        return formattedResults;
    } catch (error) {
        writeLog("ERROR", "Unable to process Cucumber results.", {
            correlationId: correlationId,
            stage: "failed",
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            errorMessage: error && error.message,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            message: `[ERROR] correlationId=${correlationId} Unable to process Cucumber results: ${error.message}`,
        });
        throw error;
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
    // Pulse QuickJS does not expose Node crypto; this identifier is for correlation, not security.
    let timestamp = Date.now();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
        const randomNibble = (timestamp + Math.floor(Math.random() * 16)) % 16;
        timestamp = Math.floor(timestamp / 16);
        return (character === "x" ? randomNibble : (randomNibble & 3) | 8).toString(16);
    });
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
        .replace(/\b(authorization|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi, "$1=[REDACTED]")
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
