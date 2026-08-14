/**
 * Trigger name: ChatOpsEvent
 * Call source: other Pulse Actions via emitEvent()
 * Payload:
 *   {
 *     message: "insert message contents here",
 *     correlationId: "optional cross-rule correlation id"
 *   }
 * Constants:
 *   TeamsWebhook: HTTPS callback URL from the Teams Workflows / Power Automate trigger
 *   TEAMS_MESSAGE_MAX_CHARACTERS: optional, defaults to 4000
 *   TEAMS_REQUEST_TIMEOUT_MS: optional, defaults to 15000 (maximum 45000)
 *
 * External documentation:
 * https://learn.microsoft.com/en-us/connectors/teams/#when-a-teams-webhook-request-is-received
 */

const RULE_NAME = "MicrosoftTeamsWorkflow";
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
        const workflowUrl = normalizeTeamsWebhookUrl(constants && constants.TeamsWebhook);
        const maximumCharacters = getBoundedPositiveInteger(
            constants && constants.TEAMS_MESSAGE_MAX_CHARACTERS,
            DEFAULT_MESSAGE_MAX_CHARACTERS,
            40000
        );
        const requestTimeoutMs = getBoundedPositiveInteger(
            constants && constants.TEAMS_REQUEST_TIMEOUT_MS,
            DEFAULT_REQUEST_TIMEOUT_MS,
            MAX_REQUEST_TIMEOUT_MS
        );
        const originalMessage = String(body.message);
        const message = truncateMessage(originalMessage, maximumCharacters);
        const truncated = message !== originalMessage;

        writeLog("INFO", "Sending ChatOps message to Microsoft Teams Workflow.", {
            correlationId: correlationId,
            stage: "delivery",
            provider: "microsoft-teams",
            deliveryMode: "workflow-webhook",
            originalCharacters: originalMessage.length,
            postedCharacters: message.length,
            truncated: truncated,
        });

        let response;
        try {
            response = await postTeamsMessage(workflowUrl, createAdaptiveCardPayload(message), requestTimeoutMs);
        } catch (error) {
            const timedOut = error && (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED");
            const rootCause = sanitizeLogText(error && error.message ? error.message : error);
            const wrappedError = createRuleError(
                timedOut ? "TEAMS_WORKFLOW_TIMEOUT" : "TEAMS_WORKFLOW_REQUEST_FAILED",
                timedOut
                    ? `Microsoft Teams Workflow did not respond within ${requestTimeoutMs} ms.${formatCauseSuffix(rootCause)}`
                    : `Unable to invoke the Microsoft Teams Workflow webhook.${formatCauseSuffix(rootCause)}`,
                error
            );
            wrappedError.requestTimeoutMs = requestTimeoutMs;
            throw wrappedError;
        }

        if (!response.ok) {
            const error = createRuleError(
                "TEAMS_WORKFLOW_HTTP_ERROR",
                `Microsoft Teams Workflow returned HTTP ${response.status}.`
            );
            error.httpStatus = response.status;
            error.responseSummary = sanitizeLogText(response.text);
            throw error;
        }

        writeLog("INFO", "Microsoft Teams Workflow accepted the ChatOps message.", {
            correlationId: correlationId,
            stage: "delivery",
            provider: "microsoft-teams",
            deliveryMode: "workflow-webhook",
            httpStatus: response.status,
            truncated: truncated,
            durationMs: Date.now() - startedAt,
        });

        return {
            correlationId: correlationId,
            provider: "microsoft-teams",
            deliveryMode: "workflow-webhook",
            httpStatus: response.status,
            truncated: truncated,
            postedCharacters: message.length,
        };
    } catch (error) {
        writeLog("ERROR", "Unable to send the ChatOps message to Microsoft Teams.", Object.assign({
            correlationId: correlationId,
            stage: "delivery",
            provider: "microsoft-teams",
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

function normalizeTeamsWebhookUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        throw createRuleError(
            "CONFIG_INVALID",
            "Pulse constant 'TeamsWebhook' must contain the Microsoft Teams Workflow callback URL."
        );
    }

    const httpsUrlPattern = /^https:\/\/[^\s/?#]+(?::\d+)?\/[^\s#]+$/i;
    if (!httpsUrlPattern.test(raw) || raw.includes("#")) {
        throw createRuleError(
            "CONFIG_INVALID",
            "Pulse constant 'TeamsWebhook' must contain a complete HTTPS Microsoft Teams Workflow callback URL."
        );
    }
    return raw;
}

function createAdaptiveCardPayload(message) {
    return {
        type: "message",
        attachments: [
            {
                contentType: "application/vnd.microsoft.card.adaptive",
                contentUrl: null,
                content: {
                    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                    type: "AdaptiveCard",
                    version: "1.2",
                    body: [
                        {
                            type: "TextBlock",
                            text: message,
                            wrap: true,
                        },
                    ],
                },
            },
        ],
    };
}

function postTeamsMessage(workflowUrl, payload, timeoutMs) {
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
        .replace(/https:\/\/[^\s"'<>]+\/(?:powerautomate\/automations\/direct\/)?workflows\/[^\s"'<>]*/gi, "[REDACTED_TEAMS_WEBHOOK]")
        .replace(/([?&](?:sig|signature|token)=)[^&\s"']+/gi, "$1[REDACTED]")
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

exports.createAdaptiveCardPayload = createAdaptiveCardPayload;
exports.getSafeErrorFields = getSafeErrorFields;
exports.normalizeTeamsWebhookUrl = normalizeTeamsWebhookUrl;
exports.postTeamsMessage = postTeamsMessage;
exports.truncateMessage = truncateMessage;
