/**
 * Pulse usage: Connect the Trigger named UpdateQTestWithResults to this Action;
 * result parsers invoke it after formatting qTest automation logs.
 *
 * Input: Preferred destination contract:
 *   {
 *     "deliverySchemaVersion": 2,
 *     "correlationId": "delivery-generated-id",
 *     "projectId": "5",
 *     "targetType": "test-cycle" | "test-suite",
 *     "targetId": "TC-123" | "TS-456",
 *     "logs": []
 *   }
 *
 * Backward-compatible destination fields:
 *   - testcycle, test_cycle, or testCycle
 *   - testsuite, test_suite, or testSuite
 *
 * Test Cycle endpoint:
 *   POST /api/v3/projects/{projectId}/auto-test-logs?type=automation
 *   { test_cycle, test_logs }
 *
 * Test Suite endpoint:
 *   POST /api/v3.1/projects/{projectId}/test-runs/0/auto-test-logs?type=automation
 *   { test_suite, execution_date, test_logs }
 *
 * Required constants:
 *   QTEST_TOKEN: qTest user bearer token from Resources > API & SDK
 *   ManagerURL: qTest Manager hostname without the protocol
 *               (for example, example.qtestnet.com)
 * Optional constants:
 *   QTEST_REQUEST_TIMEOUT_MS, QTEST_QUEUE_MAX_ATTEMPTS,
 *   QTEST_QUEUE_POLL_DELAY_MS, QTEST_QUEUE_TIMEOUT_MS
 * Triggers: CheckProcessingQueue and ChatOpsEvent are optional.
 * Output: qTest processing queue id/state plus the resolved destination.
 * See qtest/README.md and https://qtest.dev.tricentis.com/.
 */

const axios = require("axios");
const { Webhooks } = require("@qasymphony/pulse-sdk");

const RULE_NAME = "UpdateQTestWithResults";
const TEST_CYCLE = "test-cycle";
const TEST_SUITE = "test-suite";
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_QUEUE_MAX_ATTEMPTS = 20;
const DEFAULT_QUEUE_POLL_DELAY_MS = 5000;
const DEFAULT_QUEUE_TIMEOUT_MS = 600000;
const MAX_LOG_VALUE_LENGTH = 500;

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    let destination;

    function findTrigger(name) {
        return (triggers || []).find((trigger) => trigger.name === name);
    }

    async function emitEvent(name, payload, options) {
        const required = Boolean(options && options.required);
        const trigger = findTrigger(name);

        if (!trigger) {
            const error = createRuleError("TRIGGER_NOT_FOUND", `Webhook named '${name}' was not found.`);
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
            const wrappedError = error && error.code === "CHILD_EXECUTION_STATUS_UNKNOWN"
                ? error
                : createPulseInvocationError(name, error);
            writeLog(required ? "ERROR" : "WARN", wrappedError.message, Object.assign({
                correlationId: correlationId,
                stage: "emit",
                event: name,
            }, getPulseInvocationLogFields(wrappedError, payload)));
            if (required) throw wrappedError;
            return [];
        }
    }

    try {
        validatePayload(body);
        validateConstants(constants);
        destination = resolveDestination(body);

        const request = buildSubmissionRequest(body, constants, destination);

        writeLog("INFO", "Starting qTest result submission.", {
            correlationId: correlationId,
            stage: "submission",
            schemaVersion: body.deliverySchemaVersion || 1,
            projectId: body.projectId,
            targetType: destination.targetType,
            targetId: destination.targetId,
            apiVersion: destination.apiVersion,
            executionDate: request.executionDate,
            testLogs: request.testLogs.length,
        });

        let response;
        try {
            response = await axios(request.axiosOptions);
        } catch (error) {
            throw createRuleError("QTEST_SUBMISSION_FAILED", "The qTest result submission request failed.", error);
        }

        if (!response || !response.data || response.data.id === undefined || response.data.id === null) {
            throw createRuleError(
                "QTEST_INVALID_RESPONSE",
                "qTest accepted the request but did not return a processing queue id."
            );
        }

        const queueId = response.data.id;
        const queueState = response.data.state || "UNKNOWN";

        writeLog("INFO", "qTest accepted the result submission.", {
            correlationId: correlationId,
            stage: "submission",
            targetType: destination.targetType,
            targetId: destination.targetId,
            httpStatus: response.status,
            qTestQueueId: queueId,
            qTestQueueState: queueState,
            durationMs: Date.now() - startedAt,
        });

        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            message:
                `[INFO] correlationId=${correlationId} qTest queued ${request.testLogs.length} result(s) ` +
                `for ${destination.targetType} '${destination.targetId}' with queue id ${queueId}.`,
        });

        await emitEvent("CheckProcessingQueue", {
            correlationId: correlationId,
            queueId: queueId,
            attempt: 1,
            maxAttempts: getPositiveInteger(constants.QTEST_QUEUE_MAX_ATTEMPTS, DEFAULT_QUEUE_MAX_ATTEMPTS),
            pollDelayMs: getNonNegativeInteger(constants.QTEST_QUEUE_POLL_DELAY_MS, DEFAULT_QUEUE_POLL_DELAY_MS),
            timeoutMs: getPositiveInteger(constants.QTEST_QUEUE_TIMEOUT_MS, DEFAULT_QUEUE_TIMEOUT_MS),
            startedAt: new Date().toISOString(),
        });

        return {
            correlationId: correlationId,
            queueId: queueId,
            state: queueState,
            targetType: destination.targetType,
            targetId: destination.targetId,
        };
    } catch (error) {
        const errorCode = error && error.code ? error.code : "QTEST_SUBMISSION_FAILED";
        const errorFields = getSafeErrorFields(error);

        writeLog("ERROR", "Unable to submit results to qTest.", Object.assign({
            correlationId: correlationId,
            stage: "submission",
            targetType: destination && destination.targetType,
            targetId: destination && destination.targetId,
            errorCode: errorCode,
            durationMs: Date.now() - startedAt,
        }, errorFields));

        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: errorCode,
            message:
                `[ERROR] correlationId=${correlationId} Unable to submit results to qTest: ` +
                errorFields.errorMessage,
        });
        throw error;
    }
};

function validatePayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw createRuleError("CONTRACT_INVALID", "The Pulse event payload is missing.");
    }
    if (!isPresent(payload.projectId)) {
        throw createRuleError("CONTRACT_INVALID", "The Pulse event payload is missing 'projectId'.");
    }
    if (!Array.isArray(payload.logs) || payload.logs.length === 0) {
        throw createRuleError("CONTRACT_INVALID", "The Pulse event payload must contain at least one item in 'logs'.");
    }
}

function validateConstants(constants) {
    if (!constants || !isPresent(constants.ManagerURL) || !isPresent(constants.QTEST_TOKEN)) {
        throw createRuleError(
            "CONFIG_INVALID",
            "Pulse constants 'ManagerURL' and 'QTEST_TOKEN' must be configured."
        );
    }
}

function resolveDestination(payload) {
    const canonicalTypeProvided = isPresent(payload && payload.targetType);
    const canonicalIdProvided = isPresent(payload && payload.targetId);

    if (canonicalTypeProvided !== canonicalIdProvided) {
        throw createRuleError(
            "TARGET_INVALID",
            "The canonical destination requires both 'targetType' and 'targetId'."
        );
    }

    const testCycle = getConsistentAliasValue(payload, ["testcycle", "test_cycle", "testCycle"], "Test Cycle");
    const testSuite = getConsistentAliasValue(payload, ["testsuite", "test_suite", "testSuite"], "Test Suite");

    if (isPresent(testCycle) && isPresent(testSuite)) {
        throw createRuleError("TARGET_INVALID", "The payload cannot contain both Test Cycle and Test Suite targets.");
    }

    const candidates = [];
    if (canonicalTypeProvided) {
        candidates.push({
            targetType: normalizeTargetType(payload.targetType),
            targetId: normalizeTargetId(payload.targetId),
        });
    }
    if (isPresent(testCycle)) {
        candidates.push({ targetType: TEST_CYCLE, targetId: normalizeTargetId(testCycle) });
    }
    if (isPresent(testSuite)) {
        candidates.push({ targetType: TEST_SUITE, targetId: normalizeTargetId(testSuite) });
    }

    if (candidates.length === 0) {
        throw createRuleError(
            "TARGET_INVALID",
            "The payload must provide 'targetType'/'targetId', 'testcycle', or 'testsuite'."
        );
    }

    const destination = candidates[0];
    const conflicting = candidates.some(
        (candidate) =>
            candidate.targetType !== destination.targetType ||
            String(candidate.targetId) !== String(destination.targetId)
    );

    if (conflicting) {
        throw createRuleError("TARGET_INVALID", "Canonical and compatibility destination fields do not match.");
    }

    return Object.assign({}, destination, {
        apiVersion: destination.targetType === TEST_SUITE ? "v3.1" : "v3",
    });
}

function buildSubmissionRequest(payload, constants, destination) {
    const managerBaseUrl = normalizeManagerBaseUrl(constants.ManagerURL);
    const projectId = encodeURIComponent(String(payload.projectId));
    const requestTimeoutMs = getPositiveInteger(constants.QTEST_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
    const isTestSuite = destination.targetType === TEST_SUITE;
    const testLogs = normalizeTestLogs(payload.logs, isTestSuite);
    const executionDate = isTestSuite ? getExecutionDate(payload) : undefined;
    const url = isTestSuite
        ? `${managerBaseUrl}/api/v3.1/projects/${projectId}/test-runs/0/auto-test-logs?type=automation`
        : `${managerBaseUrl}/api/v3/projects/${projectId}/auto-test-logs?type=automation`;
    const data = isTestSuite
        ? {
            test_suite: destination.targetId,
            execution_date: executionDate,
            test_logs: testLogs,
        }
        : {
            test_cycle: destination.targetId,
            test_logs: testLogs,
        };

    return {
        executionDate: executionDate,
        testLogs: testLogs,
        axiosOptions: {
            url: url,
            method: "post",
            headers: {
                "Content-Type": "application/json",
                Authorization: `bearer ${constants.QTEST_TOKEN}`,
            },
            data: data,
            timeout: requestTimeoutMs,
        },
    };
}

function normalizeTestLogs(logs, zeroBaseStepOrder) {
    return logs.map((testLog) => {
        const copy = Object.assign({}, testLog);
        if (Array.isArray(testLog && testLog.test_step_logs)) {
            copy.test_step_logs = testLog.test_step_logs.map((testStepLog, index) =>
                Object.assign({}, testStepLog, zeroBaseStepOrder ? { order: index } : {})
            );
        }
        return copy;
    });
}

function getExecutionDate(payload) {
    const explicitValue = payload.execution_date || payload.executionDate;
    const candidates = (explicitValue
        ? [explicitValue]
        : (payload.logs || [])
            .map((testLog) => testLog && testLog.exe_start_date)
            .filter(Boolean)
    )
        .map(getValidIsoDatePart)
        .filter(Boolean)
        .sort();

    if (candidates.length === 0) {
        throw createRuleError(
            "CONTRACT_INVALID",
            "Test Suite submission requires 'execution_date' or at least one valid 'exe_start_date'."
        );
    }

    return candidates[0];
}

function getValidIsoDatePart(value) {
    const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return "";

    const date = new Date(`${match[1]}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : "";
}

function normalizeManagerBaseUrl(value) {
    const raw = String(value || "").trim();
    const invalidMessage =
        "Pulse constant 'ManagerURL' must contain only the qTest Manager hostname, without a protocol, " +
        "path, query, or fragment (for example, 'example.qtestnet.com').";

    if (!isValidHostname(raw)) {
        throw createRuleError("CONFIG_INVALID", invalidMessage);
    }

    return `https://${raw}`;
}

function isValidHostname(value) {
    if (!value || value.length > 253 || !/^[A-Za-z0-9.-]+$/.test(value)) return false;

    return value.split(".").every((label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
    );
}

function normalizeTargetType(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if ([TEST_CYCLE, "testcycle", "cycle"].includes(normalized)) return TEST_CYCLE;
    if ([TEST_SUITE, "testsuite", "suite"].includes(normalized)) return TEST_SUITE;
    throw createRuleError(
        "TARGET_INVALID",
        `Unsupported targetType '${value}'. Expected '${TEST_CYCLE}' or '${TEST_SUITE}'.`
    );
}

function normalizeTargetId(value) {
    const normalized = String(value === undefined || value === null ? "" : value).trim();
    if (!normalized) {
        throw createRuleError("TARGET_INVALID", "The destination target id is empty.");
    }
    return normalized;
}

function getConsistentAliasValue(payload, propertyNames, label) {
    const values = propertyNames
        .filter((propertyName) => isPresent(payload && payload[propertyName]))
        .map((propertyName) => normalizeTargetId(payload[propertyName]));

    if (values.length === 0) return undefined;
    if (values.some((value) => value !== values[0])) {
        throw createRuleError("TARGET_INVALID", `${label} compatibility fields do not match.`);
    }
    return values[0];
}

function isPresent(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizePulseExecutions(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
}

function getCorrelationId(value) {
    if (isPresent(value)) return String(value).trim();
    return require("crypto").randomUUID();
}

function createRuleError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function createUnknownPulseInvocationError(name) {
    const error = createRuleError(
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
    const error = createRuleError(
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

function getSafeErrorFields(error) {
    const rootError = getRootCause(error);
    const responseData = rootError && rootError.response && rootError.response.data;
    const responseMessage =
        typeof responseData === "string"
            ? responseData
            : responseData && (responseData.message || responseData.error || responseData.content);

    return {
        errorCode: error && error.code,
        errorMessage: sanitizeLogText(error && error.message ? error.message : String(error)),
        httpStatus: (error && error.httpStatus) || (rootError && rootError.response && rootError.response.status),
        responseSummary: responseMessage ? sanitizeLogText(responseMessage) : undefined,
        invocationOutcome: error && error.invocationOutcome,
        automaticRetry: error && error.automaticRetry,
        reconciliationRequired: error && error.reconciliationRequired,
    };
}

function getRootCause(error) {
    let current = error;
    while (current && current.cause && current.cause !== current) current = current.cause;
    return current;
}

function sanitizeLogText(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/(bearer\s+)[^\s,;"']+/gi, "$1[REDACTED]")
        .replace(/([?&](?:sig|token|api[_-]?key)=)[^&\s"']+/gi, "$1[REDACTED]")
        .replace(
            /\b(authorization|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi,
            "$1=[REDACTED]"
        )
        .slice(0, MAX_LOG_VALUE_LENGTH);
}

function getPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getNonNegativeInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function writeLog(level, message, fields) {
    const entries = Object.assign({ rule: RULE_NAME }, fields || {});
    const context = Object.keys(entries)
        .filter((key) => entries[key] !== undefined && entries[key] !== null && entries[key] !== "")
        .map((key) => `${key}=${formatLogValue(entries[key])}`)
        .join(" ");
    const line = `[${level}] ${context} message=${formatLogValue(message)}`;

    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
}

function formatLogValue(value) {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    return JSON.stringify(sanitizeLogText(rendered));
}

exports.buildSubmissionRequest = buildSubmissionRequest;
exports.getExecutionDate = getExecutionDate;
exports.getSafeErrorFields = getSafeErrorFields;
exports.normalizeManagerBaseUrl = normalizeManagerBaseUrl;
exports.normalizePulseExecutions = normalizePulseExecutions;
exports.normalizeTargetType = normalizeTargetType;
exports.normalizeTestLogs = normalizeTestLogs;
exports.resolveDestination = resolveDestination;
