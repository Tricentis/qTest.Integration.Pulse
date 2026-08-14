/**
 * Trigger name: ChatOpsEvent
 * Call source: other Pulse Actions via emitEvent()
 * Payload:
 *   {
 *     message: "insert message contents here",
 *     correlationId: "optional cross-rule correlation id"
 *   }
 * Constants:
 *   SlackWorkflowWebhook: https://hooks.slack.com/triggers/replace/with/your-workflow-id
 *   SLACK_MESSAGE_MAX_CHARACTERS: optional, defaults to 4000
 *   SLACK_REQUEST_TIMEOUT_MS: optional, defaults to 15000 (maximum 45000)
 *
 * ChatOpsWebhook remains a temporary compatibility alias for
 * SlackWorkflowWebhook, but its value must be a Workflow Builder /triggers/
 * URL. Legacy /services/ Incoming Webhook URLs are intentionally rejected.
 *
 * External documentation:
 * https://slack.com/help/articles/360041352714-Build-a-workflow--Create-a-workflow-that-starts-outside-of-Slack
 */

const RULE_NAME = "SlackWorkflow";
const DEFAULT_MESSAGE_MAX_CHARACTERS = 4000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 45000;
const MAX_LOG_VALUE_LENGTH = 500;
const TRUNCATION_SUFFIX = "\n[truncated by qTest Pulse]";

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();

    try {
        validatePayload(body);
        const workflowUrl = normalizeWorkflowUrl(getWorkflowUrl(constants));
        const maximumCharacters = getBoundedPositiveInteger(
            constants && constants.SLACK_MESSAGE_MAX_CHARACTERS,
            DEFAULT_MESSAGE_MAX_CHARACTERS,
            40000
        );
        const requestTimeoutMs = getBoundedPositiveInteger(
            constants && constants.SLACK_REQUEST_TIMEOUT_MS,
            DEFAULT_REQUEST_TIMEOUT_MS,
            MAX_REQUEST_TIMEOUT_MS
        );
        const originalMessage = String(body.message);
        const message = truncateMessage(originalMessage, maximumCharacters);
        const truncated = message !== originalMessage;

        writeLog("INFO", "Sending ChatOps message to Slack Workflow Builder.", {
            correlationId: correlationId,
            stage: "delivery",
            provider: "slack",
            deliveryMode: "workflow-webhook",
            originalCharacters: originalMessage.length,
            postedCharacters: message.length,
            truncated: truncated,
        });

        let response;
        try {
            response = await postWorkflowMessage(workflowUrl, { message: message }, requestTimeoutMs);
        } catch (error) {
            const timedOut = error && (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED");
            const rootCause = sanitizeLogText(error && error.message ? error.message : error);
            const wrappedError = createRuleError(
                timedOut ? "SLACK_WORKFLOW_TIMEOUT" : "SLACK_WORKFLOW_REQUEST_FAILED",
                timedOut
                    ? `Slack Workflow Builder did not respond within ${requestTimeoutMs} ms.${formatCauseSuffix(rootCause)}`
                    : `Unable to invoke the Slack Workflow Builder webhook.${formatCauseSuffix(rootCause)}`,
                error
            );
            wrappedError.requestTimeoutMs = requestTimeoutMs;
            throw wrappedError;
        }

        if (!response.ok) {
            const error = createRuleError(
                "SLACK_WORKFLOW_HTTP_ERROR",
                `Slack Workflow Builder returned HTTP ${response.status}.`
            );
            error.httpStatus = response.status;
            error.responseSummary = sanitizeLogText(response.text);
            throw error;
        }

        writeLog("INFO", "Slack Workflow Builder accepted the ChatOps message.", {
            correlationId: correlationId,
            stage: "delivery",
            provider: "slack",
            deliveryMode: "workflow-webhook",
            httpStatus: response.status,
            truncated: truncated,
            durationMs: Date.now() - startedAt,
        });

        return {
            correlationId: correlationId,
            provider: "slack",
            deliveryMode: "workflow-webhook",
            httpStatus: response.status,
            truncated: truncated,
            postedCharacters: message.length,
        };
    } catch (error) {
        writeLog("ERROR", "Unable to send the ChatOps message to Slack.", Object.assign({
            correlationId: correlationId,
            stage: "delivery",
            provider: "slack",
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(error)));
        throw error;
    }
};

function validatePayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw createRuleError("CONTRACT_INVALID", "The ChatOps event payload is missing.");
    }
    if (payload.message === undefined || payload.message === null || String(payload.message).trim() === "") {
        throw createRuleError("CONTRACT_INVALID", "The ChatOps event payload is missing 'message'.");
    }
}

function getWorkflowUrl(constants) {
    const value = constants && (constants.SlackWorkflowWebhook || constants.ChatOpsWebhook);
    if (!value || !String(value).trim()) {
        throw createRuleError(
            "CONFIG_INVALID",
            "Pulse constant 'SlackWorkflowWebhook' must contain the Slack Workflow Builder webhook URL."
        );
    }
    return String(value).trim();
}

function normalizeWorkflowUrl(value) {
    const raw = String(value || "").trim();
    const workflowUrlPattern =
        /^https:\/\/hooks\.slack(?:-gov)?\.com\/triggers\/[^/?#\s]+(?:\/[^/?#\s]+)*\/?$/i;
    if (!workflowUrlPattern.test(raw)) {
        throw createRuleError(
            "CONFIG_INVALID",
            "The Slack webhook must be an HTTPS Workflow Builder URL under hooks.slack.com/triggers/."
        );
    }
    return raw;
}

function postWorkflowMessage(workflowUrl, payload, timeoutMs) {
    return require("axios").post(workflowUrl, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: timeoutMs,
        validateStatus: () => true,
    }).then((response) => {
        const status = Number(response && response.status) || 0;
        return {
            ok: status >= 200 && status <= 299,
            status: status,
            text: summarizeResponseBody(response && response.data),
        };
    });
}

function summarizeResponseBody(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value.slice(0, MAX_LOG_VALUE_LENGTH);

    try {
        return JSON.stringify(value).slice(0, MAX_LOG_VALUE_LENGTH);
    } catch (error) {
        return String(value).slice(0, MAX_LOG_VALUE_LENGTH);
    }
}

function truncateMessage(value, maximumCharacters) {
    const message = String(value);
    if (message.length <= maximumCharacters) return message;
    if (maximumCharacters <= TRUNCATION_SUFFIX.length) return TRUNCATION_SUFFIX.slice(0, maximumCharacters);
    return message.slice(0, maximumCharacters - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

function getBoundedPositiveInteger(value, fallback, maximum) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
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

function createRuleError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function getSafeErrorFields(error) {
    const rootError = error && error.cause ? error.cause : error;
    return {
        errorCode: error && error.code,
        errorMessage: sanitizeLogText(error && error.message ? error.message : String(error)),
        httpStatus: error && error.httpStatus,
        responseSummary: error && error.responseSummary,
        requestTimeoutMs: error && error.requestTimeoutMs,
        rootCauseCode: rootError && rootError !== error ? rootError.code : undefined,
        rootCause: rootError && rootError !== error ? sanitizeLogText(rootError.message || rootError) : undefined,
    };
}

function formatCauseSuffix(rootCause) {
    return rootCause ? ` Cause: ${rootCause}` : "";
}

function sanitizeLogText(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/https:\/\/hooks\.slack(?:-gov)?\.com\/triggers\/[^\s"']+/gi, "[REDACTED_SLACK_WEBHOOK]")
        .replace(/(bearer\s+)[^\s,;"']+/gi, "$1[REDACTED]")
        .replace(/\b(token|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi, "$1=[REDACTED]")
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

exports.getSafeErrorFields = getSafeErrorFields;
exports.normalizeWorkflowUrl = normalizeWorkflowUrl;
exports.postWorkflowMessage = postWorkflowMessage;
exports.truncateMessage = truncateMessage;
