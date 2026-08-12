/**
 * Triggers a CircleCI pipeline definition through API v2.
 *
 * Event: { correlationId?: string, branch?: string, tag?: string,
 * configBranch?: string, parameters?: object }
 * Required constants: CircleCIProvider, CircleCIOrganization, CircleCIProject,
 * CircleCIPipelineDefinitionId, CircleCIToken. CircleCIBranch is used when the
 * event does not supply a branch or tag.
 * Optional constant: CI_REQUEST_TIMEOUT_MS (default 15000, maximum 45000)
 */

const RULE_NAME = "TriggerCircleCIPipeline";
const PROVIDER = "circleci";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 45000;
const MAX_LOG_VALUE_LENGTH = 500;

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    let pipeline;
    try {
        const config = getConfig(body || {}, constants);
        pipeline = `${config.organization}/${config.project}:${config.definitionId}`;
        const requestUrl = `https://circleci.com/api/v2/project/${encodeURIComponent(config.vcsProvider)}` +
            `/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/pipeline/run`;
        const requestBody = createPipelinePayload(config);
        writeLog("INFO", "Triggering CircleCI pipeline.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            ref: config.tag || config.branch, parameterCount: config.parameters ? Object.keys(config.parameters).length : 0,
        });
        const response = await require("axios").post(requestUrl, requestBody, {
            headers: { "Circle-Token": config.token, "Content-Type": "application/json" },
            timeout: config.timeoutMs, validateStatus: () => true,
        });
        ensureSuccessfulResponse(response, "CIRCLECI_HTTP_ERROR", "CircleCI");
        const result = {
            correlationId: correlationId, provider: PROVIDER, pipeline: pipeline,
            ref: config.tag || config.branch, httpStatus: Number(response.status),
            runId: response.data && response.data.id,
            runUrl: response.data && (response.data.web_url || response.data.url),
        };
        writeLog("INFO", "CircleCI accepted the pipeline request.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            ref: result.ref, httpStatus: result.httpStatus, runId: result.runId, durationMs: Date.now() - startedAt,
        });
        await emitOptionalChatOps(triggers, createChatOpsPayload(result, "accepted"), correlationId);
        return result;
    } catch (error) {
        const wrapped = normalizeRequestError(error, "CIRCLECI_REQUEST_FAILED", "CIRCLECI_TIMEOUT", constants);
        writeLog("ERROR", "Unable to trigger the CircleCI pipeline.", Object.assign({
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(wrapped)));
        await emitOptionalChatOps(triggers, createChatOpsPayload({ correlationId: correlationId, pipeline: pipeline }, "failed", wrapped), correlationId);
        throw wrapped;
    }
};

function getConfig(body, constants) {
    const branch = firstPresent(body.branch, body.tag ? undefined : constants && constants.CircleCIBranch);
    const tag = firstPresent(body.tag);
    if (branch && tag) throw createRuleError("CONTRACT_INVALID", "CircleCI event must provide a branch or tag, not both.");
    if (!branch && !tag) throw createRuleError("CONFIG_INVALID", "Provide event.branch, event.tag, or Pulse constant 'CircleCIBranch'.");
    const parameters = getOptionalObject(body, "parameters");
    return {
        vcsProvider: requireConstant(constants, "CircleCIProvider"),
        organization: requireConstant(constants, "CircleCIOrganization"),
        project: requireConstant(constants, "CircleCIProject"),
        definitionId: requireConstant(constants, "CircleCIPipelineDefinitionId"),
        token: requireConstant(constants, "CircleCIToken"),
        branch: branch, tag: tag,
        configBranch: firstPresent(body.configBranch, branch, constants && constants.CircleCIBranch, "main"),
        parameters: parameters,
        timeoutMs: getRequestTimeout(constants),
    };
}

function createPipelinePayload(config) {
    const payload = {
        definition_id: config.definitionId,
        config: { branch: String(config.configBranch) },
        checkout: config.tag ? { tag: String(config.tag) } : { branch: String(config.branch) },
    };
    if (config.parameters) payload.parameters = config.parameters;
    return payload;
}

function getOptionalObject(body, name) {
    const value = body && body[name];
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw createRuleError("CONTRACT_INVALID", `CircleCI event '${name}' must be an object.`);
    return value;
}

function ensureSuccessfulResponse(response, code, providerName) {
    const status = Number(response && response.status) || 0; if (status >= 200 && status <= 299) return;
    const error = createRuleError(code, `${providerName} returned HTTP ${status}.`); error.httpStatus = status;
    error.responseSummary = summarizeResponseBody(response && response.data); throw error;
}

function createChatOpsPayload(result, outcome, error) {
    const pipeline = result.pipeline || "unknown";
    return { correlationId: result.correlationId,
        message: outcome === "accepted"
            ? `[INFO] correlationId=${result.correlationId} CircleCI accepted pipeline '${pipeline}'${formatRunSuffix(result.runId)}.`
            : `[ERROR] correlationId=${result.correlationId} CircleCI failed to trigger pipeline '${pipeline}' (${error.code || "UNKNOWN"}).`,
        source: { type: "ci-trigger", provider: PROVIDER, pipeline: pipeline, runId: result.runId } };
}
function formatRunSuffix(runId) { return runId === undefined || runId === null || runId === "" ? "" : ` with pipeline id '${runId}'`; }

async function emitOptionalChatOps(triggers, payload, correlationId) {
    const trigger = (triggers || []).find((candidate) => candidate.name === "ChatOpsEvent");
    if (!trigger) { writeLog("WARN", "Optional ChatOpsEvent trigger was not found.", { correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "TRIGGER_NOT_FOUND" }); return []; }
    writeLog("INFO", "Invoking optional ChatOps event.", { correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", emittedPayloadBytes: getJsonByteLength(payload) });
    try {
        const { Webhooks } = require("@qasymphony/pulse-sdk");
        const executions = normalizePulseExecutions(await new Webhooks().invoke(trigger, payload));
        if (executions.length === 0) { writeLog("WARN", "Pulse returned no ChatOps execution metadata; reconcile before retrying.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN", invocationOutcome: "unknown", automaticRetry: "disabled",
        }); return []; }
        executions.forEach((execution) => writeLog("INFO", "ChatOps Pulse execution created.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", childExecutionId: execution && execution.id, childExecutionStatus: execution && execution.status,
        })); return executions;
    } catch (error) {
        writeLog("WARN", "Unable to confirm the optional ChatOps invocation; automatic retry is disabled.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN",
            httpStatus: getHttpStatus(error), errorMessage: sanitizeLogText(error && error.message), invocationOutcome: "unknown", automaticRetry: "disabled",
        }); return [];
    }
}

function requireConstant(constants, name) { const value = constants && constants[name]; if (value === undefined || value === null || String(value).trim() === "") throw createRuleError("CONFIG_INVALID", `Pulse constant '${name}' is required.`); return String(value).trim(); }
function getRequestTimeout(constants) { const parsed = Number.parseInt(constants && constants.CI_REQUEST_TIMEOUT_MS, 10); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_REQUEST_TIMEOUT_MS) : DEFAULT_REQUEST_TIMEOUT_MS; }
function normalizeRequestError(error, requestCode, timeoutCode, constants) {
    if (error && error.code && /_(?:HTTP_ERROR|INVALID)$/.test(error.code)) return error;
    const timeoutMs = getRequestTimeout(constants); const timedOut = error && (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED");
    const cause = sanitizeLogText(error && error.message ? error.message : error);
    const wrapped = createRuleError(timedOut ? timeoutCode : requestCode,
        timedOut ? `The CI request did not respond within ${timeoutMs} ms.${formatCauseSuffix(cause)}` : `Unable to invoke the CI endpoint.${formatCauseSuffix(cause)}`, error);
    wrapped.requestTimeoutMs = timeoutMs; return wrapped;
}
function getSafeErrorFields(error) { const root = error && error.cause ? error.cause : error; return {
    errorCode: error && error.code, errorMessage: sanitizeLogText(error && error.message ? error.message : error),
    httpStatus: error && error.httpStatus || getHttpStatus(root), responseSummary: error && error.responseSummary,
    requestTimeoutMs: error && error.requestTimeoutMs, rootCauseCode: root && root !== error ? root.code : undefined,
}; }
function normalizePulseExecutions(response) { if (Array.isArray(response)) return response; if (response && Array.isArray(response.data)) return response.data; return []; }
function summarizeResponseBody(value) { if (value === undefined || value === null) return ""; try { return sanitizeLogText(typeof value === "string" ? value : JSON.stringify(value)); } catch (error) { return sanitizeLogText(value); } }
function getCorrelationId(value) { if (value !== undefined && value !== null && String(value).trim()) return String(value).trim(); return require("crypto").randomUUID(); }
function getHttpStatus(error) { const status = error && error.response && (error.response.status || error.response.statusCode) || error && error.status; const parsed = Number(status); if (Number.isInteger(parsed)) return parsed; const match = String(error && error.message || "").match(/\b([45]\d{2})\b/); return match ? Number(match[1]) : undefined; }
function getJsonByteLength(value) { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch (error) { return undefined; } }
function firstPresent() { for (let index = 0; index < arguments.length; index += 1) { const value = arguments[index]; if (value !== undefined && value !== null && value !== "") return String(value); } return undefined; }
function createRuleError(code, message, cause) { const error = new Error(message); error.code = code; if (cause) error.cause = cause; return error; }
function formatCauseSuffix(value) { return value ? ` Cause: ${value}` : ""; }
function sanitizeLogText(value) { return String(value === undefined || value === null ? "" : value)
    .replace(/(bearer\s+|basic\s+)[^\s,;"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:sig|token|api[_-]?key|key)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/("[^"]*(?:authorization|token|api[_-]?key|password|secret|sig)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/\b(authorization|circle-token|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi, "$1=[REDACTED]").slice(0, MAX_LOG_VALUE_LENGTH); }
function writeLog(level, message, fields) { const entries = Object.assign({ rule: RULE_NAME }, fields || {}); const contextText = Object.keys(entries)
    .filter((key) => entries[key] !== undefined && entries[key] !== null && entries[key] !== "")
    .map((key) => `${key}=${formatLogValue(entries[key])}`).join(" "); const line = `[${level}] ${contextText} message=${formatLogValue(message)}`;
    if (level === "ERROR") console.error(line); else if (level === "WARN") console.warn(line); else console.log(line); }
function formatLogValue(value) { return JSON.stringify(sanitizeLogText(typeof value === "string" ? value : JSON.stringify(value))); }

exports.createPipelinePayload = createPipelinePayload;
exports.getConfig = getConfig;
