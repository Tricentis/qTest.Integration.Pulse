/**
 * Runs an Azure Pipeline and optionally emits ChatOpsEvent.
 *
 * Event: {
 *   correlationId?: string,
 *   ref?: string,
 *   variables?: object,
 *   templateParameters?: object,
 *   resources?: object,
 *   stagesToSkip?: string[]
 * }
 * Required constants: AzureDevOpsOrganization, AzureDevOpsProject,
 * AzureDevOpsPipelineId, AzureDevOpsToken (AZDO_TOKEN is a compatibility alias)
 * Optional constant: CI_REQUEST_TIMEOUT_MS (default 15000, maximum 45000)
 */

const RULE_NAME = "TriggerAzurePipeline";
const PROVIDER = "azure-pipelines";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 45000;
const MAX_LOG_VALUE_LENGTH = 500;

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    let pipeline;

    try {
        const config = getConfig(constants);
        const requestBody = createRunPayload(body || {});
        pipeline = `${config.organization}/${config.project}:${config.pipelineId}`;
        const requestUrl = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}` +
            `/_apis/pipelines/${encodeURIComponent(config.pipelineId)}/runs?api-version=7.1`;

        writeLog("INFO", "Running Azure Pipeline.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            ref: getRequestedRef(requestBody), variableCount: requestBody.variables ? Object.keys(requestBody.variables).length : 0,
            templateParameterCount: requestBody.templateParameters ? Object.keys(requestBody.templateParameters).length : 0,
        });
        const response = await require("axios").post(requestUrl, requestBody, {
            auth: { username: "", password: config.token },
            headers: { "Content-Type": "application/json" },
            timeout: config.timeoutMs,
            validateStatus: () => true,
        });
        ensureSuccessfulResponse(response, "AZURE_PIPELINE_HTTP_ERROR", "Azure Pipelines");

        const result = {
            correlationId: correlationId,
            provider: PROVIDER,
            pipeline: pipeline,
            ref: getRequestedRef(requestBody),
            httpStatus: Number(response.status),
            runId: response.data && response.data.id,
            runUrl: response.data && (response.data._links && response.data._links.web && response.data._links.web.href || response.data.url),
        };
        writeLog("INFO", "Azure Pipelines accepted the run request.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            ref: result.ref, httpStatus: result.httpStatus, runId: result.runId, durationMs: Date.now() - startedAt,
        });
        await emitOptionalChatOps(triggers, createChatOpsPayload(result, "accepted"), correlationId);
        return result;
    } catch (error) {
        const wrapped = normalizeRequestError(error, "AZURE_PIPELINE_REQUEST_FAILED", "AZURE_PIPELINE_TIMEOUT", constants);
        writeLog("ERROR", "Unable to run the Azure Pipeline.", Object.assign({
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: pipeline,
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(wrapped)));
        await emitOptionalChatOps(triggers, createChatOpsPayload({
            correlationId: correlationId, provider: PROVIDER, pipeline: pipeline,
        }, "failed", wrapped), correlationId);
        throw wrapped;
    }
};

function getConfig(constants) {
    return {
        organization: requireConstant(constants, "AzureDevOpsOrganization"),
        project: requireConstant(constants, "AzureDevOpsProject"),
        pipelineId: requireConstant(constants, "AzureDevOpsPipelineId"),
        token: requireAnyConstant(constants, ["AzureDevOpsToken", "AZDO_TOKEN"]),
        timeoutMs: getRequestTimeout(constants),
    };
}

function createRunPayload(body) {
    const payload = {};
    if (body.variables !== undefined) payload.variables = normalizeVariables(getOptionalObject(body, "variables"));
    if (body.templateParameters !== undefined) payload.templateParameters = getOptionalObject(body, "templateParameters");
    if (body.resources !== undefined) payload.resources = cloneJson(getOptionalObject(body, "resources"));
    if (body.stagesToSkip !== undefined) {
        if (!Array.isArray(body.stagesToSkip) || body.stagesToSkip.some((stage) => !String(stage).trim())) {
            throw createRuleError("CONTRACT_INVALID", "Azure Pipelines event 'stagesToSkip' must be an array of stage names.");
        }
        payload.stagesToSkip = body.stagesToSkip.map(String);
    }
    if (body.ref !== undefined && body.ref !== null && String(body.ref).trim()) {
        payload.resources = payload.resources || {};
        payload.resources.repositories = payload.resources.repositories || {};
        payload.resources.repositories.self = Object.assign({}, payload.resources.repositories.self, {
            refName: normalizeAzureRef(body.ref),
        });
    }
    return payload;
}

function normalizeVariables(variables) {
    const normalized = {};
    Object.keys(variables).forEach((name) => {
        const value = variables[name];
        if (!name || value === undefined || value === null) {
            throw createRuleError("CONTRACT_INVALID", "Azure Pipeline variable names and values must be defined.");
        }
        normalized[name] = typeof value === "object" && !Array.isArray(value)
            ? Object.assign({}, value)
            : { value: String(value) };
    });
    return normalized;
}

function normalizeAzureRef(value) {
    const ref = String(value).trim();
    return /^refs\//i.test(ref) ? ref : `refs/heads/${ref}`;
}

function getRequestedRef(payload) {
    return payload && payload.resources && payload.resources.repositories && payload.resources.repositories.self &&
        payload.resources.repositories.self.refName;
}

function getOptionalObject(body, name) {
    const value = body && body[name];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw createRuleError("CONTRACT_INVALID", `Azure Pipelines event '${name}' must be an object.`);
    }
    return value;
}

function cloneJson(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (error) { throw createRuleError("CONTRACT_INVALID", "Azure Pipeline resources must be JSON-serializable.", error); }
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
            ? `[INFO] correlationId=${result.correlationId} Azure Pipelines accepted pipeline '${pipeline}'${formatRunSuffix(result.runId)}.`
            : `[ERROR] correlationId=${result.correlationId} Azure Pipelines failed to run pipeline '${pipeline}' (${error.code || "UNKNOWN"}).`,
        source: { type: "ci-trigger", provider: PROVIDER, pipeline: pipeline, runId: result.runId },
    };
}

function formatRunSuffix(runId) { return runId === undefined || runId === null || runId === "" ? "" : ` with run id '${runId}'`; }

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
function requireAnyConstant(constants, names) {
    for (const name of names) {
        const value = constants && constants[name];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    throw createRuleError("CONFIG_INVALID", `Pulse constant '${names[0]}' is required.`);
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
function getCorrelationId(value) { if (value !== undefined && value !== null && String(value).trim()) return String(value).trim(); return require("crypto").randomUUID(); }
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

exports.createRunPayload = createRunPayload;
exports.normalizeAzureRef = normalizeAzureRef;
exports.normalizeVariables = normalizeVariables;
