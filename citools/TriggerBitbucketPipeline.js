/**
 * Runs a Bitbucket Cloud pipeline and optionally emits ChatOpsEvent.
 *
 * Event: { correlationId?: string, ref?: string, refType?: "branch"|"tag",
 * commit?: string, selector?: string, variables?: object }
 * Required constants: BitbucketWorkspace, BitbucketRepository, BitbucketToken,
 * and BitbucketBranch unless event.ref is supplied.
 * Optional constant: CI_REQUEST_TIMEOUT_MS (default 15000, maximum 45000)
 */

const RULE_NAME = "TriggerBitbucketPipeline";
const PROVIDER = "bitbucket-pipelines";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 45000;
const MAX_LOG_VALUE_LENGTH = 500;

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    let pipeline;
    try {
        const config = getConfig(body || {}, constants);
        pipeline = `${config.workspace}/${config.repository}`;
        const requestUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(config.workspace)}` +
            `/${encodeURIComponent(config.repository)}/pipelines`;
        const requestBody = createPipelinePayload(config);
        writeLog("INFO", "Running Bitbucket pipeline.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            ref: config.ref, refType: config.refType, variableCount: config.variables ? Object.keys(config.variables).length : 0,
        });
        const response = await require("axios").post(requestUrl, requestBody, createRequestOptions(config));
        ensureSuccessfulResponse(response, "BITBUCKET_PIPELINE_HTTP_ERROR", "Bitbucket Pipelines");
        const result = {
            correlationId: correlationId, provider: PROVIDER, pipeline: pipeline, ref: config.ref,
            httpStatus: Number(response.status), runId: response.data && response.data.uuid,
            runNumber: response.data && response.data.build_number,
            runUrl: response.data && response.data.links && response.data.links.html && response.data.links.html.href,
        };
        writeLog("INFO", "Bitbucket accepted the pipeline request.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            ref: result.ref, httpStatus: result.httpStatus, runId: result.runId, runNumber: result.runNumber,
            durationMs: Date.now() - startedAt,
        });
        await emitOptionalChatOps(triggers, createChatOpsPayload(result, "accepted"), correlationId);
        return result;
    } catch (error) {
        const wrapped = normalizeRequestError(error, "BITBUCKET_PIPELINE_REQUEST_FAILED", "BITBUCKET_PIPELINE_TIMEOUT", constants);
        writeLog("ERROR", "Unable to run the Bitbucket pipeline.", Object.assign({
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(wrapped)));
        await emitOptionalChatOps(triggers, createChatOpsPayload({ correlationId: correlationId, pipeline: pipeline }, "failed", wrapped), correlationId);
        throw wrapped;
    }
};

function getConfig(body, constants) {
    const refType = String(firstPresent(body.refType, "branch")).toLowerCase();
    if (!["branch", "named_branch", "bookmark", "tag"].includes(refType)) {
        throw createRuleError("CONTRACT_INVALID", "Bitbucket refType must be branch, named_branch, bookmark, or tag.");
    }
    return {
        workspace: requireConstant(constants, "BitbucketWorkspace"),
        repository: requireConstant(constants, "BitbucketRepository"),
        token: requireConstant(constants, "BitbucketToken"),
        username: optionalConstant(constants, "BitbucketUserName"),
        ref: requireEventOrConstant(body, "ref", constants, "BitbucketBranch"),
        refType: refType,
        commit: firstPresent(body.commit),
        selector: firstPresent(body.selector),
        variables: getOptionalObject(body, "variables"),
        timeoutMs: getRequestTimeout(constants),
    };
}

function createRequestOptions(config) {
    const options = {
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        timeout: config.timeoutMs,
        validateStatus: () => true,
    };
    if (config.username) options.auth = { username: config.username, password: config.token };
    else options.headers.Authorization = `Bearer ${config.token}`;
    return options;
}

function createPipelinePayload(config) {
    const target = { type: "pipeline_ref_target", ref_type: config.refType, ref_name: config.ref };
    if (config.commit) target.commit = { type: "commit", hash: config.commit };
    if (config.selector) target.selector = { type: "custom", pattern: config.selector };
    const payload = { target: target };
    if (config.variables) payload.variables = normalizeVariables(config.variables);
    return payload;
}

function normalizeVariables(variables) {
    return Object.keys(variables).map((key) => {
        const source = variables[key];
        if (!key || source === undefined || source === null) throw createRuleError("CONTRACT_INVALID", "Bitbucket variable names and values must be defined.");
        if (typeof source === "object" && !Array.isArray(source)) {
            if (source.value === undefined || source.value === null) throw createRuleError("CONTRACT_INVALID", `Bitbucket variable '${key}' is missing value.`);
            return { key: key, value: String(source.value), secured: Boolean(source.secured) };
        }
        return { key: key, value: String(source), secured: false };
    });
}

function getOptionalObject(body, name) { const value = body && body[name]; if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw createRuleError("CONTRACT_INVALID", `Bitbucket event '${name}' must be an object.`); return value; }
function ensureSuccessfulResponse(response, code, providerName) { const status = Number(response && response.status) || 0; if (status >= 200 && status <= 299) return;
    const error = createRuleError(code, `${providerName} returned HTTP ${status}.`); error.httpStatus = status; error.responseSummary = summarizeResponseBody(response && response.data); throw error; }
function createChatOpsPayload(result, outcome, error) { const pipeline = result.pipeline || "unknown"; return {
    correlationId: result.correlationId,
    message: outcome === "accepted"
        ? `[INFO] correlationId=${result.correlationId} Bitbucket accepted pipeline '${pipeline}'${formatRunSuffix(result.runNumber || result.runId)}.`
        : `[ERROR] correlationId=${result.correlationId} Bitbucket failed to run pipeline '${pipeline}' (${error.code || "UNKNOWN"}).`,
    source: { type: "ci-trigger", provider: PROVIDER, pipeline: pipeline, runId: result.runId },
}; }
function formatRunSuffix(runId) { return runId === undefined || runId === null || runId === "" ? "" : ` with run id '${runId}'`; }

async function emitOptionalChatOps(triggers, payload, correlationId) {
    const trigger = (triggers || []).find((candidate) => candidate.name === "ChatOpsEvent");
    if (!trigger) { writeLog("WARN", "Optional ChatOpsEvent trigger was not found.", { correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "TRIGGER_NOT_FOUND" }); return []; }
    writeLog("INFO", "Invoking optional ChatOps event.", { correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", emittedPayloadBytes: getJsonByteLength(payload) });
    try {
        const { Webhooks } = require("@qasymphony/pulse-sdk"); const executions = normalizePulseExecutions(await new Webhooks().invoke(trigger, payload));
        if (executions.length === 0) { writeLog("WARN", "Pulse returned no ChatOps execution metadata; reconcile before retrying.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN", invocationOutcome: "unknown", automaticRetry: "disabled",
        }); return []; }
        executions.forEach((execution) => writeLog("INFO", "ChatOps Pulse execution created.", { correlationId: correlationId, stage: "emit", event: "ChatOpsEvent",
            childExecutionId: execution && execution.id, childExecutionStatus: execution && execution.status })); return executions;
    } catch (error) { writeLog("WARN", "Unable to confirm the optional ChatOps invocation; automatic retry is disabled.", {
        correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN", httpStatus: getHttpStatus(error),
        errorMessage: sanitizeLogText(error && error.message), invocationOutcome: "unknown", automaticRetry: "disabled",
    }); return []; }
}

function requireConstant(constants, name) { const value = constants && constants[name]; if (value === undefined || value === null || String(value).trim() === "") throw createRuleError("CONFIG_INVALID", `Pulse constant '${name}' is required.`); return String(value).trim(); }
function optionalConstant(constants, name) { const value = constants && constants[name]; return value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim(); }
function requireEventOrConstant(body, eventName, constants, constantName) { const value = body && body[eventName] !== undefined ? body[eventName] : constants && constants[constantName];
    if (value === undefined || value === null || String(value).trim() === "") throw createRuleError("CONFIG_INVALID", `Provide event.${eventName} or Pulse constant '${constantName}'.`); return String(value).trim(); }
function getRequestTimeout(constants) { const parsed = Number.parseInt(constants && constants.CI_REQUEST_TIMEOUT_MS, 10); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_REQUEST_TIMEOUT_MS) : DEFAULT_REQUEST_TIMEOUT_MS; }
function normalizeRequestError(error, requestCode, timeoutCode, constants) { if (error && error.code && /_(?:HTTP_ERROR|INVALID)$/.test(error.code)) return error;
    const timeoutMs = getRequestTimeout(constants); const timedOut = error && (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED"); const cause = sanitizeLogText(error && error.message ? error.message : error);
    const wrapped = createRuleError(timedOut ? timeoutCode : requestCode, timedOut ? `The CI request did not respond within ${timeoutMs} ms.${formatCauseSuffix(cause)}` : `Unable to invoke the CI endpoint.${formatCauseSuffix(cause)}`, error);
    wrapped.requestTimeoutMs = timeoutMs; return wrapped; }
function getSafeErrorFields(error) { const root = error && error.cause ? error.cause : error; return { errorCode: error && error.code,
    errorMessage: sanitizeLogText(error && error.message ? error.message : error), httpStatus: error && error.httpStatus || getHttpStatus(root),
    responseSummary: error && error.responseSummary, requestTimeoutMs: error && error.requestTimeoutMs, rootCauseCode: root && root !== error ? root.code : undefined }; }
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
function getHttpStatus(error) { const status = error && error.response && (error.response.status || error.response.statusCode) || error && error.status; const parsed = Number(status); if (Number.isInteger(parsed)) return parsed;
    const match = String(error && error.message || "").match(/\b([45]\d{2})\b/); return match ? Number(match[1]) : undefined; }
function getJsonByteLength(value) { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch (error) { return undefined; } }
function firstPresent() { for (let index = 0; index < arguments.length; index += 1) { const value = arguments[index]; if (value !== undefined && value !== null && value !== "") return String(value); } return undefined; }
function createRuleError(code, message, cause) { const error = new Error(message); error.code = code; if (cause) error.cause = cause; return error; }
function formatCauseSuffix(value) { return value ? ` Cause: ${value}` : ""; }
function sanitizeLogText(value) { return String(value === undefined || value === null ? "" : value)
    .replace(/(bearer\s+|basic\s+)[^\s,;"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:sig|token|api[_-]?key|key)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/("[^"]*(?:authorization|token|api[_-]?key|password|secret|sig)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/\b(authorization|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi, "$1=[REDACTED]").slice(0, MAX_LOG_VALUE_LENGTH); }
function writeLog(level, message, fields) { const entries = Object.assign({ rule: RULE_NAME }, fields || {}); const contextText = Object.keys(entries)
    .filter((key) => entries[key] !== undefined && entries[key] !== null && entries[key] !== "").map((key) => `${key}=${formatLogValue(entries[key])}`).join(" ");
    const line = `[${level}] ${contextText} message=${formatLogValue(message)}`; if (level === "ERROR") console.error(line); else if (level === "WARN") console.warn(line); else console.log(line); }
function formatLogValue(value) { return JSON.stringify(sanitizeLogText(typeof value === "string" ? value : JSON.stringify(value))); }

exports.createPipelinePayload = createPipelinePayload;
exports.createRequestOptions = createRequestOptions;
exports.normalizeVariables = normalizeVariables;
