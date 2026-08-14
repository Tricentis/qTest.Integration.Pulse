/**
 * Queues a Jenkins job and optionally emits ChatOpsEvent.
 *
 * Event: { correlationId?: string, parameters?: object, tag?: string }
 * `event.parameters` selects buildWithParameters. Legacy `event.tag` maps to
 * parameter `Tag`. With neither, the standard build endpoint is used.
 * Required constants: JenkinsUserName, JenkinsAPIToken, JenkinsURL,
 * JenkinsJobName, JenkinsJobToken. JenkinsParamJob is a compatibility alias
 * for JenkinsJobName.
 * Optional constant: CI_REQUEST_TIMEOUT_MS (default 15000, maximum 45000)
 */

const RULE_NAME = "TriggerJenkins";
const PROVIDER = "jenkins";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 45000;
const MAX_LOG_VALUE_LENGTH = 500;

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    let jobName;
    let dispatchMode;
    let parameterCount;

    try {
        const config = getConfig(constants);
        const parameters = getBuildParameters(body);
        jobName = config.jobName;
        parameterCount = Object.keys(parameters).length;
        dispatchMode = parameterCount > 0 ? "parameterized" : "standard";
        logInsecureTransport(config.baseUrl, correlationId);
        writeLog("INFO", "Requesting Jenkins crumb.", {
            correlationId: correlationId,
            stage: "authentication",
            provider: PROVIDER,
            pipeline: jobName,
        });

        const axios = require("axios");
        const crumbResponse = await axios.get(`${config.baseUrl}/crumbIssuer/api/xml`, {
            auth: config.auth,
            params: { xpath: 'concat(//crumbRequestField,":",//crumb)' },
            timeout: config.timeoutMs,
            validateStatus: () => true,
        });
        ensureSuccessfulResponse(crumbResponse, "JENKINS_CRUMB_HTTP_ERROR", "Jenkins crumb issuer");
        const crumb = parseCrumb(crumbResponse.data);

        writeLog("INFO", "Queueing Jenkins job.", {
            correlationId: correlationId,
            stage: "dispatch",
            provider: PROVIDER,
            pipeline: jobName,
            dispatchMode: dispatchMode,
            parameterCount: parameterCount,
        });
        const response = await axios.post(
            `${config.baseUrl}/${getJenkinsJobPath(jobName)}/${dispatchMode === "parameterized" ? "buildWithParameters" : "build"}`,
            null,
            {
                auth: config.auth,
                headers: { [crumb.header]: crumb.value },
                params: Object.assign({}, parameters, { token: config.jobToken }),
                timeout: config.timeoutMs,
                validateStatus: () => true,
            }
        );
        ensureSuccessfulResponse(response, "JENKINS_HTTP_ERROR", "Jenkins");

        const runUrl = response.headers && (response.headers.location || response.headers.Location);
        const result = {
            correlationId: correlationId,
            provider: PROVIDER,
            pipeline: jobName,
            httpStatus: Number(response.status),
            runId: extractTrailingId(runUrl),
            runUrl: runUrl,
            dispatchMode: dispatchMode,
            parameterCount: parameterCount,
        };

        writeLog("INFO", "Jenkins accepted the job request.", {
            correlationId: correlationId,
            stage: "dispatch",
            provider: PROVIDER,
            pipeline: jobName,
            httpStatus: result.httpStatus,
            runId: result.runId,
            dispatchMode: dispatchMode,
            parameterCount: parameterCount,
            durationMs: Date.now() - startedAt,
        });
        await emitOptionalChatOps(triggers, createChatOpsPayload(result, "accepted"), correlationId);
        return result;
    } catch (error) {
        const wrapped = normalizeRequestError(error, "JENKINS_REQUEST_FAILED", "JENKINS_TIMEOUT", constants);
        writeLog("ERROR", "Unable to queue the Jenkins job.", Object.assign({
            correlationId: correlationId,
            stage: "dispatch",
            provider: PROVIDER,
            pipeline: jobName,
            dispatchMode: dispatchMode,
            parameterCount: parameterCount,
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(wrapped)));
        await emitOptionalChatOps(
            triggers,
            createChatOpsPayload({
                correlationId: correlationId,
                provider: PROVIDER,
                pipeline: jobName,
                dispatchMode: dispatchMode,
            }, "failed", wrapped),
            correlationId
        );
        throw wrapped;
    }
};

function getConfig(constants) {
    return {
        baseUrl: normalizeBaseUrl(requireConstant(constants, "JenkinsURL"), "JenkinsURL"),
        auth: {
            username: requireConstant(constants, "JenkinsUserName"),
            password: requireConstant(constants, "JenkinsAPIToken"),
        },
        jobName: requireAnyConstant(constants, ["JenkinsJobName", "JenkinsParamJob"]),
        jobToken: requireConstant(constants, "JenkinsJobToken"),
        timeoutMs: getRequestTimeout(constants),
    };
}

function getBuildParameters(body) {
    const supplied = body && body.parameters;
    if (supplied !== undefined && (!supplied || typeof supplied !== "object" || Array.isArray(supplied))) {
        throw createRuleError("CONTRACT_INVALID", "Jenkins event 'parameters' must be an object.");
    }
    const parameters = Object.assign({}, supplied || {});
    if (body && body.tag !== undefined && body.tag !== null && parameters.Tag === undefined) {
        parameters.Tag = String(body.tag);
    }
    Object.keys(parameters).forEach((name) => {
        if (!name || parameters[name] === undefined || parameters[name] === null) {
            throw createRuleError("CONTRACT_INVALID", "Jenkins parameter names and values must be defined.");
        }
        parameters[name] = typeof parameters[name] === "object"
            ? JSON.stringify(parameters[name])
            : String(parameters[name]);
    });
    return parameters;
}

function parseCrumb(value) {
    const rendered = String(value === undefined || value === null ? "" : value);
    const separator = rendered.indexOf(":");
    if (separator <= 0 || separator === rendered.length - 1) {
        throw createRuleError("JENKINS_CRUMB_INVALID", "Jenkins returned an invalid crumb response.");
    }
    return {
        header: rendered.slice(0, separator).trim(),
        value: rendered.slice(separator + 1).trim(),
    };
}

function getJenkinsJobPath(jobName) {
    const segments = String(jobName).split("/").filter(Boolean);
    if (segments.length === 0) throw createRuleError("CONFIG_INVALID", "Jenkins job name is invalid.");
    return segments.map((segment) => `job/${encodeURIComponent(segment)}`).join("/");
}

function ensureSuccessfulResponse(response, code, providerName) {
    const status = Number(response && response.status) || 0;
    if (status >= 200 && status <= 299) return;
    const error = createRuleError(code, `${providerName} returned HTTP ${status}.`);
    error.httpStatus = status;
    error.responseSummary = summarizeResponseBody(response && response.data);
    throw error;
}

function createChatOpsPayload(result, outcome, error) {
    const pipeline = result.pipeline || "unknown";
    return {
        correlationId: result.correlationId,
        message: outcome === "accepted"
            ? `[INFO] correlationId=${result.correlationId} Jenkins accepted ${result.dispatchMode || "standard"} pipeline '${pipeline}'${formatRunSuffix(result.runId)}.`
            : `[ERROR] correlationId=${result.correlationId} Jenkins failed to queue pipeline '${pipeline}' (${error.code || "UNKNOWN"}).`,
        source: {
            type: "ci-trigger",
            provider: PROVIDER,
            pipeline: pipeline,
            runId: result.runId,
            dispatchMode: result.dispatchMode,
        },
    };
}

function formatRunSuffix(runId) {
    return runId === undefined || runId === null || runId === "" ? "" : ` with queue id '${runId}'`;
}

async function emitOptionalChatOps(triggers, payload, correlationId) {
    const trigger = (triggers || []).find((candidate) => candidate.name === "ChatOpsEvent");
    if (!trigger) {
        writeLog("WARN", "Optional ChatOpsEvent trigger was not found.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "TRIGGER_NOT_FOUND",
        });
        return [];
    }
    writeLog("INFO", "Invoking optional ChatOps event.", {
        correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", emittedPayloadBytes: getJsonByteLength(payload),
    });
    try {
        const { Webhooks } = require("@qasymphony/pulse-sdk");
        const executions = normalizePulseExecutions(await new Webhooks().invoke(trigger, payload));
        if (executions.length === 0) {
            writeLog("WARN", "Pulse returned no ChatOps execution metadata; reconcile before retrying.", {
                correlationId: correlationId, stage: "emit", event: "ChatOpsEvent",
                errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN", invocationOutcome: "unknown", automaticRetry: "disabled",
            });
            return [];
        }
        executions.forEach((execution) => writeLog("INFO", "ChatOps Pulse execution created.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent",
            childExecutionId: execution && execution.id, childExecutionStatus: execution && execution.status,
        }));
        return executions;
    } catch (error) {
        writeLog("WARN", "Unable to confirm the optional ChatOps invocation; automatic retry is disabled.", {
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent",
            errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN", httpStatus: getHttpStatus(error),
            errorMessage: sanitizeLogText(error && error.message), invocationOutcome: "unknown", automaticRetry: "disabled",
        });
        return [];
    }
}

function normalizeBaseUrl(value, constantName) {
    const raw = String(value || "").trim();
    const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s?#]*)?\/?$/i.test(candidate) || candidate.includes("@")) {
        throw createRuleError("CONFIG_INVALID", `Pulse constant '${constantName}' must contain an HTTP(S) CI server base URL.`);
    }
    return candidate.replace(/\/+$/, "");
}

function logInsecureTransport(baseUrl, correlationId) {
    if (/^http:\/\//i.test(baseUrl)) writeLog("WARN", "CI server uses unencrypted HTTP; migrate the base URL to HTTPS when supported.", {
        correlationId: correlationId, stage: "configuration", provider: PROVIDER, insecureTransport: true,
    });
}

function requireConstant(constants, name) {
    const value = constants && constants[name];
    if (value === undefined || value === null || String(value).trim() === "") {
        throw createRuleError("CONFIG_INVALID", `Pulse constant '${name}' is required.`);
    }
    return String(value).trim();
}

function requireAnyConstant(constants, names) {
    for (const name of names) {
        const value = constants && constants[name];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    throw createRuleError("CONFIG_INVALID", `Pulse constant '${names[0]}' is required.`);
}

function getRequestTimeout(constants) {
    const parsed = Number.parseInt(constants && constants.CI_REQUEST_TIMEOUT_MS, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_REQUEST_TIMEOUT_MS) : DEFAULT_REQUEST_TIMEOUT_MS;
}

function normalizeRequestError(error, requestCode, timeoutCode, constants) {
    if (error && error.code && /_(?:HTTP_ERROR|INVALID)$/.test(error.code)) return error;
    const timeoutMs = getRequestTimeout(constants);
    const timedOut = error && (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED");
    const cause = sanitizeLogText(error && error.message ? error.message : error);
    const wrapped = createRuleError(
        timedOut ? timeoutCode : requestCode,
        timedOut ? `The CI request did not respond within ${timeoutMs} ms.${formatCauseSuffix(cause)}` : `Unable to invoke the CI endpoint.${formatCauseSuffix(cause)}`,
        error
    );
    wrapped.requestTimeoutMs = timeoutMs;
    return wrapped;
}

function getSafeErrorFields(error) {
    const root = error && error.cause ? error.cause : error;
    return {
        errorCode: error && error.code,
        errorMessage: sanitizeLogText(error && error.message ? error.message : error),
        httpStatus: error && error.httpStatus || getHttpStatus(root),
        responseSummary: error && error.responseSummary,
        requestTimeoutMs: error && error.requestTimeoutMs,
        rootCauseCode: root && root !== error ? root.code : undefined,
    };
}

function normalizePulseExecutions(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
}

function summarizeResponseBody(value) {
    if (value === undefined || value === null) return "";
    try { return sanitizeLogText(typeof value === "string" ? value : JSON.stringify(value)); }
    catch (error) { return sanitizeLogText(value); }
}

function extractTrailingId(value) {
    const match = String(value || "").match(/\/(\d+)\/?$/);
    return match ? match[1] : undefined;
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

function getHttpStatus(error) {
    const status = error && error.response && (error.response.status || error.response.statusCode) || error && error.status;
    const parsed = Number(status);
    if (Number.isInteger(parsed)) return parsed;
    const match = String(error && error.message || "").match(/\b([45]\d{2})\b/);
    return match ? Number(match[1]) : undefined;
}

function getJsonByteLength(value) {
    try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
    catch (error) { return undefined; }
}

function createRuleError(code, message, cause) {
    const error = new Error(message); error.code = code; if (cause) error.cause = cause; return error;
}

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

exports.getJenkinsJobPath = getJenkinsJobPath;
exports.getBuildParameters = getBuildParameters;
exports.normalizeBaseUrl = normalizeBaseUrl;
exports.parseCrumb = parseCrumb;
