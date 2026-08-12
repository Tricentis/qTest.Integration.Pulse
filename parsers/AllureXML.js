/**
 * Pulse usage: Parses Allure XML results delivered by delivery.js.
 * Input: A delivery envelope containing Base64 XML plus qTest project and
 * exactly one Test Cycle or Test Suite destination.
 * Constants: None.
 * Triggers: UpdateQTestWithResults is required; ChatOpsEvent is optional.
 * Output: Formatted qTest automation logs forwarded to the submission rule.
 * See parsers/README.md and delivery/README.md for wiring and contracts.
 */

import { Webhooks } from "@qasymphony/pulse-sdk";
import xml2js from "xml2js";

const RULE_NAME = "AllureXML";

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    const emitEvent = createEventEmitter(triggers, correlationId);

    try {
        let { projectId, testcycle, result } = body;
        let testLogs = [];
        let testResults = Buffer.from(result, "base64").toString("utf8");
        const parsedResult = await xml2js.parseStringPromise(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        });
        let testSuiteName = parsedResult["ns2:test-suite"].name.trim();
        let testCases = Array.isArray(parsedResult["ns2:test-suite"]["test-cases"]["test-case"])
            ? parsedResult["ns2:test-suite"]["test-cases"]["test-case"]
            : [parsedResult["ns2:test-suite"]["test-cases"]["test-case"]];

        testCases.forEach(function (testCase) {
            let testSteps = [];
            let {
                name: testCaseName,
                $: { start: testCaseStartDate, stop: testCaseEndDate, status: testCaseStatus },
                steps,
            } = testCase;

            let testCaseSteps = steps && steps.step ? (Array.isArray(steps.step) ? steps.step : [steps.step]) : [];
            let stepNumber = 1;
            testCaseSteps.forEach(function (testStep) {
                let testStepObj = {
                    description: testStep.name,
                    expected_result: testStep.name,
                    actual_result: testStep.name,
                    order: stepNumber,
                    status: testStep.$.status,
                };
                testSteps.push(testStepObj);
                stepNumber++;
            });

            let testLog = {
                status: testCaseStatus,
                name: testCaseName,
                attachments: [],
                exe_start_date: new Date(parseInt(testCaseStartDate)).toISOString(),
                exe_end_date: new Date(parseInt(testCaseEndDate)).toISOString(),
                automation_content: testCaseName,
                module_names: [testSuiteName],
                test_step_logs: testSteps,
            };
            testLogs.push(testLog);
        });

        let formattedResults = {
            deliverySchemaVersion: body.deliverySchemaVersion,
            correlationId: correlationId,
            projectId: projectId,
            targetType: body.targetType,
            targetId: body.targetId,
            testcycle: testcycle,
            testsuite: body.testsuite,
            logs: testLogs,
        };

        writeLog("INFO", "Allure XML results parsed successfully.", {
            correlationId: correlationId,
            stage: "parse",
            parsed: testLogs.length,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("UpdateQTestWithResults", formattedResults, { required: true });
        return formattedResults;
    } catch (error) {
        writeLog("ERROR", "Unable to process Allure XML results.", {
            correlationId: correlationId,
            stage: "failed",
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            errorMessage: error && error.message,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            message: `[ERROR] correlationId=${correlationId} Unable to process Allure XML results: ${error.message}`,
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
            writeLog(required ? "ERROR" : "WARN", error.message, { correlationId, stage: "emit", event: name, errorCode: error.code });
            if (required) throw error;
            return [];
        }
        writeLog("INFO", "Invoking downstream Pulse event.", {
            correlationId, stage: "emit", event: name, emittedPayloadBytes: getJsonByteLength(payload),
        });
        try {
            const executions = normalizePulseExecutions(await new Webhooks().invoke(trigger, payload));
            if (executions.length === 0) {
                const unknownError = createUnknownPulseInvocationError(name);
                if (required) throw unknownError;
                writeLog("WARN", unknownError.message, Object.assign(
                    { correlationId, stage: "emit", event: name },
                    getPulseInvocationLogFields(unknownError, payload)
                ));
                return [];
            }
            executions.forEach((execution) => writeLog("INFO", "Downstream Pulse execution created.", {
                correlationId, stage: "emit", event: name,
                childExecutionId: execution && execution.id,
                childExecutionStatus: execution && execution.status,
            }));
            return executions;
        } catch (error) {
            const wrapped = error && error.code === "CHILD_EXECUTION_STATUS_UNKNOWN"
                ? error
                : createPulseInvocationError(name, error);
            writeLog(required ? "ERROR" : "WARN", wrapped.message, Object.assign(
                { correlationId, stage: "emit", event: name },
                getPulseInvocationLogFields(wrapped, payload)
            ));
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
