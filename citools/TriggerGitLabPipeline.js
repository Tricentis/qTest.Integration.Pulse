/**
 * Triggers a GitLab CI/CD pipeline and optionally emits ChatOpsEvent.
 *
 * Event: { correlationId?: string, ref?: string, variables?: object, inputs?: object }
 * Required constants: GitLabProjectId, GitLabTriggerToken, and GitLabRef unless
 * event.ref is supplied. GitLabURL defaults to https://gitlab.com.
 * Optional constant: CI_REQUEST_TIMEOUT_MS (default 15000, maximum 45000)
 */

const RULE_NAME = "TriggerGitLabPipeline";
const PROVIDER = "gitlab-ci";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 45000;
const MAX_LOG_VALUE_LENGTH = 500;

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    let pipeline;

    try {
        const config = getConfig(body, constants);
        pipeline = String(config.projectId);
        logInsecureTransport(config.baseUrl, correlationId);
        const requestBody = {};
        if (config.variables) requestBody.variables = config.variables;
        if (config.inputs) requestBody.inputs = config.inputs;
        const requestUrl = `${config.baseUrl}/api/v4/projects/${encodeURIComponent(config.projectId)}/trigger/pipeline`;

        writeLog("INFO", "Triggering GitLab pipeline.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline, ref: config.ref,
            variableCount: config.variables ? Object.keys(config.variables).length : 0,
            inputCount: config.inputs ? Object.keys(config.inputs).length : 0,
        });
        const response = await require("axios").post(requestUrl, requestBody, {
            headers: { "Content-Type": "application/json" },
            params: { token: config.token, ref: config.ref },
            timeout: config.timeoutMs,
            validateStatus: () => true,
        });
        ensureSuccessfulResponse(response, "GITLAB_HTTP_ERROR", "GitLab");

        const result = {
            correlationId: correlationId,
            provider: PROVIDER,
            pipeline: pipeline,
            ref: config.ref,
            httpStatus: Number(response.status),
            runId: response.data && response.data.id,
            runUrl: response.data && response.data.web_url,
        };
        writeLog("INFO", "GitLab accepted the pipeline request.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            ref: config.ref, httpStatus: result.httpStatus, runId: result.runId, durationMs: Date.now() - startedAt,
        });
        await emitOptionalChatOps(triggers, createChatOpsPayload(result, "accepted"), correlationId);
        return result;
    } catch (error) {
        const wrapped = normalizeRequestError(error, "GITLAB_REQUEST_FAILED", "GITLAB_TIMEOUT", constants);
        writeLog("ERROR", "Unable to trigger the GitLab pipeline.", Object.assign({
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(wrapped)));
        await emitOptionalChatOps(triggers, createChatOpsPayload({
            correlationId: correlationId, provider: PROVIDER, pipeline: pipeline,
        }, "failed", wrapped), correlationId);
        throw wrapped;
    }
};

function getConfig(body, constants) {
    return {
        baseUrl: normalizeBaseUrl(constants && constants.GitLabURL || "https://gitlab.com", "GitLabURL"),
        projectId: requireConstant(constants, "GitLabProjectId"),
        token: requireConstant(constants, "GitLabTriggerToken"),
        ref: requireEventOrConstant(body, "ref", constants, "GitLabRef"),
        variables: getOptionalObject(body, "variables"),
        inputs: getOptionalObject(body, "inputs"),
        timeoutMs: getRequestTimeout(constants),
    };
}

function getOptionalObject(body, name) {
    const value = body && body[name];
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw createRuleError("CONTRACT_INVALID", `GitLab event '${name}' must be an object.`);
    }
    return value;
}

function normalizeBaseUrl(value, constantName) {
    const raw = String(value || "").trim();
    const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s?#]*)?\/?$/i.test(candidate) || candidate.includes("@")) {
        throw createRuleError("CONFIG_INVALID", `Pulse constant '${constantName}' must contain an HTTP(S) GitLab base URL.`);
    }
    return candidate.replace(/\/+$/, "");
}

function logInsecureTransport(baseUrl, correlationId) {
    if (/^http:\/\//i.test(baseUrl)) writeLog("WARN", "GitLab uses unencrypted HTTP; migrate the base URL to HTTPS when supported.", {
        correlationId: correlationId, stage: "configuration", provider: PROVIDER, insecureTransport: true,
    });
}

function ensureSuccessfulResponse(response, code, providerName) {
    const status = Number(response && response.status) || 0;
    if (status >= 200 && status <= 299) return;
    const error = createRuleError(code, `${providerName} returned HTTP ${status}.`);
    error.httpStatus = status; error.responseSummary = summarizeResponseBody(response && response.data); throw error;
}

function createChatOpsPayload(result, outcome, error) {
    const pipeline = result.pipeline || "unknown";
    return {
        correlationId: result.correlationId,
        message: outcome === "accepted"
            ? `[INFO] correlationId=${result.correlationId} GitLab accepted pipeline '${pipeline}'${formatRunSuffix(result.runId)}.`
            : `[ERROR] correlationId=${result.correlationId} GitLab failed to trigger pipeline '${pipeline}' (${error.code || "UNKNOWN"}).`,
        source: { type: "ci-trigger", provider: PROVIDER, pipeline: pipeline, runId: result.runId },
    };
}

function formatRunSuffix(runId) { return runId === undefined || runId === null || runId === "" ? "" : ` with pipeline id '${runId}'`; }

async function emitOptionalChatOps(triggers, payload, correlationId) {
    const trigger = (triggers || []).find((candidate) => candidate.name === "ChatOpsEvent");
    if (!trigger) {
        writeLog("WARN", "Optional ChatOpsEvent trigger was not found.", { correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "TRIGGER_NOT_FOUND" });
        return [];
    }
    writeLog("INFO", "Invoking optional ChatOps event.", { correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", emittedPayloadBytes: getJsonByteLength(payload) });
    try {
        const { Webhooks } = require("@qasymphony/pulse-sdk");
        const executions = normalizePulseExecutions(await new Webhooks().invoke(trigger, payload));
        if (executions.length === 0) {
            writeLog("WARN", "Pulse returned no ChatOps execution metadata; reconcile before retrying.", {
                correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN",
                invocationOutcome: "unknown", automaticRetry: "disabled",
            });
            return [];
        }
        executions.forEach((execution) => writeLog("INFO", "ChatOps Pulse execution created.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", childExecutionId: execution && execution.id,
            childExecutionStatus: execution && execution.status,
        }));
        return executions;
    } catch (error) {
        writeLog("WARN", "Unable to confirm the optional ChatOps invocation; automatic retry is disabled.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN",
            httpStatus: getHttpStatus(error), errorMessage: sanitizeLogText(error && error.message),
            invocationOutcome: "unknown", automaticRetry: "disabled",
        });
        return [];
    }
}

function requireConstant(constants, name) {
    const value = constants && constants[name];
    if (value === undefined || value === null || String(value).trim() === "") throw createRuleError("CONFIG_INVALID", `Pulse constant '${name}' is required.`);
    return String(value).trim();
}
function requireEventOrConstant(body, eventName, constants, constantName) {
    const value = body && body[eventName] !== undefined ? body[eventName] : constants && constants[constantName];
    if (value === undefined || value === null || String(value).trim() === "") throw createRuleError("CONFIG_INVALID", `Provide event.${eventName} or Pulse constant '${constantName}'.`);
    return String(value).trim();
}
function getRequestTimeout(constants) { const parsed = Number.parseInt(constants && constants.CI_REQUEST_TIMEOUT_MS, 10); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_REQUEST_TIMEOUT_MS) : DEFAULT_REQUEST_TIMEOUT_MS; }

function normalizeRequestError(error, requestCode, timeoutCode, constants) {
    if (error && error.code && /_(?:HTTP_ERROR|INVALID)$/.test(error.code)) return error;
    const timeoutMs = getRequestTimeout(constants);
    const timedOut = error && (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED");
    const cause = sanitizeLogText(error && error.message ? error.message : error);
    const wrapped = createRuleError(timedOut ? timeoutCode : requestCode,
        timedOut ? `The CI request did not respond within ${timeoutMs} ms.${formatCauseSuffix(cause)}` : `Unable to invoke the CI endpoint.${formatCauseSuffix(cause)}`, error);
    wrapped.requestTimeoutMs = timeoutMs; return wrapped;
}

function getSafeErrorFields(error) {
    const root = error && error.cause ? error.cause : error;
    return { errorCode: error && error.code, errorMessage: sanitizeLogText(error && error.message ? error.message : error),
        httpStatus: error && error.httpStatus || getHttpStatus(root), responseSummary: error && error.responseSummary,
        requestTimeoutMs: error && error.requestTimeoutMs, rootCauseCode: root && root !== error ? root.code : undefined };
}

function normalizePulseExecutions(response) { if (Array.isArray(response)) return response; if (response && Array.isArray(response.data)) return response.data; return []; }
function summarizeResponseBody(value) { if (value === undefined || value === null) return ""; try { return sanitizeLogText(typeof value === "string" ? value : JSON.stringify(value)); } catch (error) { return sanitizeLogText(value); } }
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
function getHttpStatus(error) { const status = error && error.response && (error.response.status || error.response.statusCode) || error && error.status; const parsed = Number(status); if (Number.isInteger(parsed)) return parsed; const match = String(error && error.message || "").match(/\b([45]\d{2})\b/); return match ? Number(match[1]) : undefined; }
function getJsonByteLength(value) { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch (error) { return undefined; } }
function createRuleError(code, message, cause) { const error = new Error(message); error.code = code; if (cause) error.cause = cause; return error; }
function formatCauseSuffix(value) { return value ? ` Cause: ${value}` : ""; }

function sanitizeLogText(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
        .replace(/(bearer\s+|basic\s+)[^\s,;"']+/gi, "$1[REDACTED]")
        .replace(/([?&](?:sig|token|api[_-]?key|key)=)[^&\s"']+/gi, "$1[REDACTED]")
        .replace(/("[^"]*(?:authorization|token|api[_-]?key|password|secret|sig)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
        .replace(/\b(authorization|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi, "$1=[REDACTED]")
        .slice(0, MAX_LOG_VALUE_LENGTH);
}

function writeLog(level, message, fields) {
    const entries = Object.assign({ rule: RULE_NAME }, fields || {});
    const contextText = Object.keys(entries).filter((key) => entries[key] !== undefined && entries[key] !== null && entries[key] !== "")
        .map((key) => `${key}=${formatLogValue(entries[key])}`).join(" ");
    const line = `[${level}] ${contextText} message=${formatLogValue(message)}`;
    if (level === "ERROR") console.error(line); else if (level === "WARN") console.warn(line); else console.log(line);
}
function formatLogValue(value) { return JSON.stringify(sanitizeLogText(typeof value === "string" ? value : JSON.stringify(value))); }

exports.getConfig = getConfig;
exports.normalizeBaseUrl = normalizeBaseUrl;
