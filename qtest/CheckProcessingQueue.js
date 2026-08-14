/**
 * Pulse usage: Checks one qTest asynchronous result-processing queue state per
 * execution. Connect the Trigger named CheckProcessingQueue to this Action so
 * pending states can schedule the next bounded check.
 * Input: { queueId, correlationId?, attempt?, maxAttempts?, pollDelayMs?,
 * timeoutMs?, startedAt? }.
 * Constants: ManagerURL and QTEST_TOKEN are required; QTEST_REQUEST_TIMEOUT_MS
 * and QTEST_QUEUE_* values are optional tuning controls.
 * Triggers: CheckProcessingQueue is required for continued polling;
 * ChatOpsEvent is optional.
 * Output: Queue state, attempt, elapsed time, and correlation metadata.
 * See qtest/README.md for setup and operational semantics.
 */

const axios = require("axios");
const { Webhooks } = require("@qasymphony/pulse-sdk");

const RULE_NAME = "CheckProcessingQueue";
const PROCESSING_STATES = new Set(["IN_WAITING", "IN_PROCESSING", "PENDING"]);
const SUCCESS_STATES = new Set(["SUCCESS"]);
const FAILURE_STATES = new Set(["FAILED"]);
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_POLL_DELAY_MS = 5000;
const DEFAULT_QUEUE_TIMEOUT_MS = 600000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MAX_POLL_DELAY_MS = 60000;
const MAX_LOG_VALUE_LENGTH = 500;

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const attempt = getBoundedPositiveInteger(body && body.attempt, 1, 1000);
    const maxAttempts = getBoundedPositiveInteger(
        body && body.maxAttempts,
        getBoundedPositiveInteger(constants && constants.QTEST_QUEUE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1000),
        1000
    );
    const pollDelayMs = getBoundedNonNegativeInteger(
        body && body.pollDelayMs,
        getBoundedNonNegativeInteger(constants && constants.QTEST_QUEUE_POLL_DELAY_MS, DEFAULT_POLL_DELAY_MS, MAX_POLL_DELAY_MS),
        MAX_POLL_DELAY_MS
    );
    const timeoutMs = getBoundedPositiveInteger(
        body && body.timeoutMs,
        getBoundedPositiveInteger(constants && constants.QTEST_QUEUE_TIMEOUT_MS, DEFAULT_QUEUE_TIMEOUT_MS, 86400000),
        86400000
    );
    const requestTimeoutMs = getBoundedPositiveInteger(
        constants && constants.QTEST_REQUEST_TIMEOUT_MS,
        DEFAULT_REQUEST_TIMEOUT_MS,
        300000
    );
    const startedAtMs = getStartedAtMs(body && body.startedAt);

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
        validateInputs(body, constants, attempt, maxAttempts, startedAtMs);
        assertWithinPollingBudget(attempt, maxAttempts, startedAtMs, timeoutMs);
        const managerBaseUrl = normalizeManagerBaseUrl(constants.ManagerURL);

        writeLog("INFO", "Checking qTest processing queue.", {
            correlationId: correlationId,
            stage: "queue",
            qTestQueueId: body.queueId,
            attempt: attempt,
            maxAttempts: maxAttempts,
            elapsedMs: Date.now() - startedAtMs,
        });

        let response;
        try {
            response = await axios({
                url: `${managerBaseUrl}/api/v3/projects/queue-processing/${body.queueId}`,
                method: "get",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${constants.QTEST_TOKEN}`,
                },
                timeout: requestTimeoutMs,
            });
        } catch (error) {
            throw createRuleError("QTEST_QUEUE_REQUEST_FAILED", "Unable to read the qTest processing queue.", error);
        }

        const queueState = normalizeQueueState(response && response.data && response.data.state);
        if (!queueState) {
            throw createRuleError("QTEST_QUEUE_INVALID_RESPONSE", "qTest did not return a processing queue state.");
        }

        writeLog("INFO", "qTest processing queue checked.", {
            correlationId: correlationId,
            stage: "queue",
            httpStatus: response.status,
            qTestQueueId: body.queueId,
            qTestQueueState: queueState,
            attempt: attempt,
            elapsedMs: Date.now() - startedAtMs,
        });

        if (SUCCESS_STATES.has(queueState)) {
            await emitEvent("ChatOpsEvent", {
                correlationId: correlationId,
                message:
                    `[INFO] correlationId=${correlationId} qTest queue ${body.queueId} completed successfully ` +
                    `after ${attempt} attempt(s).`,
            });
            return createQueueResult(correlationId, body.queueId, queueState, attempt, startedAtMs);
        }

        if (FAILURE_STATES.has(queueState)) {
            const content = sanitizeLogText(response.data && response.data.content);
            throw createRuleError(
                "QTEST_QUEUE_FAILED",
                `qTest queue '${body.queueId}' failed${content ? `: ${content}` : "."}`
            );
        }

        if (!PROCESSING_STATES.has(queueState)) {
            throw createRuleError(
                "QTEST_QUEUE_UNKNOWN_STATE",
                `qTest queue '${body.queueId}' returned unknown state '${queueState}'.`
            );
        }

        assertWithinPollingBudget(attempt + 1, maxAttempts, startedAtMs, timeoutMs);
        const remainingMs = startedAtMs + timeoutMs - Date.now();
        if (pollDelayMs > remainingMs) {
            throw createQueueTimeoutError(attempt, maxAttempts, timeoutMs);
        }

        if (pollDelayMs > 0) {
            writeLog("INFO", "Waiting before the next qTest queue check.", {
                correlationId: correlationId,
                stage: "queue",
                qTestQueueId: body.queueId,
                nextAttempt: attempt + 1,
                pollDelayMs: pollDelayMs,
            });
            await delay(pollDelayMs);
        }

        const childExecutions = await emitEvent(
            "CheckProcessingQueue",
            {
                correlationId: correlationId,
                queueId: body.queueId,
                attempt: attempt + 1,
                maxAttempts: maxAttempts,
                pollDelayMs: pollDelayMs,
                timeoutMs: timeoutMs,
                startedAt: new Date(startedAtMs).toISOString(),
            },
            { required: true }
        );

        return Object.assign(createQueueResult(correlationId, body.queueId, queueState, attempt, startedAtMs), {
            nextAttempt: attempt + 1,
            childExecutions: childExecutions,
        });
    } catch (error) {
        const errorCode = error && error.code ? error.code : "QTEST_QUEUE_FAILED";
        const errorFields = getSafeErrorFields(error);
        writeLog("ERROR", "qTest processing queue check failed.", Object.assign({
            correlationId: correlationId,
            stage: "queue",
            qTestQueueId: body && body.queueId,
            attempt: attempt,
            errorCode: errorCode,
            elapsedMs: Date.now() - startedAtMs,
        }, errorFields));

        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: errorCode,
            message:
                `[ERROR] correlationId=${correlationId} qTest queue ${body && body.queueId} failed: ` +
                errorFields.errorMessage,
        });
        throw error;
    }
};

function validateInputs(body, constants, attempt, maxAttempts, startedAtMs) {
    if (!body || typeof body !== "object") {
        throw createRuleError("CONTRACT_INVALID", "The Pulse event payload is missing.");
    }
    if (body.queueId === undefined || body.queueId === null || body.queueId === "") {
        throw createRuleError("CONTRACT_INVALID", "The Pulse event payload is missing 'queueId'.");
    }
    if (!constants || !constants.ManagerURL || !constants.QTEST_TOKEN) {
        throw createRuleError(
            "CONFIG_INVALID",
            "Pulse constants 'ManagerURL' and 'QTEST_TOKEN' must be configured."
        );
    }
    if (attempt > maxAttempts) {
        throw createQueueTimeoutError(attempt, maxAttempts, 0);
    }
    if (!Number.isFinite(startedAtMs)) {
        throw createRuleError("CONTRACT_INVALID", "The queue 'startedAt' value is invalid.");
    }
}

function assertWithinPollingBudget(attempt, maxAttempts, startedAtMs, timeoutMs) {
    if (attempt > maxAttempts || Date.now() - startedAtMs >= timeoutMs) {
        throw createQueueTimeoutError(attempt, maxAttempts, timeoutMs);
    }
}

function createQueueTimeoutError(attempt, maxAttempts, timeoutMs) {
    return createRuleError(
        "QTEST_QUEUE_TIMEOUT",
        `qTest queue monitoring reached its limit (attempt ${attempt}/${maxAttempts}, timeout ${timeoutMs} ms).`
    );
}

function createQueueResult(correlationId, queueId, state, attempt, startedAtMs) {
    return {
        correlationId: correlationId,
        queueId: queueId,
        state: state,
        attempt: attempt,
        elapsedMs: Date.now() - startedAtMs,
    };
}

function normalizeQueueState(value) {
    return value === undefined || value === null ? "" : String(value).trim().toUpperCase();
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

function normalizePulseExecutions(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
}

function getCorrelationId(value) {
    if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
    }
    // Pulse QuickJS does not expose Node crypto; this identifier is for correlation, not security.
    let timestamp = Date.now();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
        const randomNibble = (timestamp + Math.floor(Math.random() * 16)) % 16;
        timestamp = Math.floor(timestamp / 16);
        return (character === "x" ? randomNibble : (randomNibble & 3) | 8).toString(16);
    });
}

function getStartedAtMs(value) {
    if (value === undefined || value === null || value === "") return Date.now();
    return new Date(value).getTime();
}

function getBoundedPositiveInteger(value, fallback, maximum) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function getBoundedNonNegativeInteger(value, fallback, maximum) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
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
    const rootError = error && error.cause ? error.cause : error;
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

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

exports.normalizePulseExecutions = normalizePulseExecutions;
exports.normalizeQueueState = normalizeQueueState;
exports.normalizeManagerBaseUrl = normalizeManagerBaseUrl;
exports.getSafeErrorFields = getSafeErrorFields;
