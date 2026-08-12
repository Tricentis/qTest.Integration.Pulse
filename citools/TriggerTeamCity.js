/**
 * Queues a TeamCity build and optionally emits ChatOpsEvent.
 *
 * Event: { correlationId?: string }
 * Required constants: TeamCityUserName, TeamCityPassword, TeamCityURL,
 * TeamCityBuildCode. TeamCityPort remains supported for legacy host-only URLs.
 * Optional constant: CI_REQUEST_TIMEOUT_MS (default 15000, maximum 45000)
 */

const RULE_NAME = "TriggerTeamCity";
const PROVIDER = "teamcity";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_REQUEST_TIMEOUT_MS = 45000;
const MAX_LOG_VALUE_LENGTH = 500;

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    let buildTypeId;

    try {
        const config = getConfig(constants);
        buildTypeId = config.buildTypeId;
        logInsecureTransport(config.baseUrl, correlationId);
        writeLog("INFO", "Queueing TeamCity build.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: buildTypeId,
        });

        const response = await require("axios").post(
            `${config.baseUrl}/httpAuth/app/rest/buildQueue`,
            `<build><buildType id="${escapeXmlAttribute(buildTypeId)}"/></build>`,
            {
                auth: { username: config.username, password: config.password },
                headers: { "Content-Type": "application/xml", Accept: "application/json" },
                timeout: config.timeoutMs,
                validateStatus: () => true,
            }
        );
        ensureSuccessfulResponse(response, "TEAMCITY_HTTP_ERROR", "TeamCity");

        const runUrl = firstPresent(
            response.data && response.data.webUrl,
            response.headers && (response.headers.location || response.headers.Location)
        );
        const result = {
            correlationId: correlationId,
            provider: PROVIDER,
            pipeline: buildTypeId,
            httpStatus: Number(response.status),
            runId: firstPresent(response.data && response.data.id, response.data && response.data.number),
            runUrl: runUrl,
        };
        writeLog("INFO", "TeamCity accepted the build request.", {
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: buildTypeId,
            httpStatus: result.httpStatus, runId: result.runId, durationMs: Date.now() - startedAt,
        });
        await emitOptionalChatOps(triggers, createChatOpsPayload(result, "accepted"), correlationId);
        return result;
    } catch (error) {
        const wrapped = normalizeRequestError(error, "TEAMCITY_REQUEST_FAILED", "TEAMCITY_TIMEOUT", constants);
        writeLog("ERROR", "Unable to queue the TeamCity build.", Object.assign({
            correlationId: correlationId, stage: "dispatch", provider: PROVIDER, pipeline: buildTypeId,
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(wrapped)));
        await emitOptionalChatOps(
            triggers,
            createChatOpsPayload({ correlationId: correlationId, provider: PROVIDER, pipeline: buildTypeId }, "failed", wrapped),
            correlationId
        );
        throw wrapped;
    }
};

function getConfig(constants) {
    return {
        username: requireConstant(constants, "TeamCityUserName"),
        password: requireConstant(constants, "TeamCityPassword"),
        baseUrl: getTeamCityBaseUrl(constants),
        buildTypeId: requireConstant(constants, "TeamCityBuildCode"),
        timeoutMs: getRequestTimeout(constants),
    };
}

function getTeamCityBaseUrl(constants) {
    const raw = requireConstant(constants, "TeamCityURL");
    if (/^https?:\/\//i.test(raw)) return normalizeBaseUrl(raw, "TeamCityURL");
    const port = constants && constants.TeamCityPort;
    const hostWithPort = port !== undefined && port !== null && String(port).trim() && !/:\d+$/.test(raw)
        ? `${raw}:${validatePort(port)}`
        : raw;
    return normalizeBaseUrl(hostWithPort, "TeamCityURL");
}

function validatePort(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw createRuleError("CONFIG_INVALID", "Pulse constant 'TeamCityPort' must be a valid TCP port.");
    }
    return parsed;
}

function escapeXmlAttribute(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/'/g, "&apos;");
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
            ? `[INFO] correlationId=${result.correlationId} TeamCity accepted pipeline '${pipeline}'${formatRunSuffix(result.runId)}.`
            : `[ERROR] correlationId=${result.correlationId} TeamCity failed to queue pipeline '${pipeline}' (${error.code || "UNKNOWN"}).`,
        source: { type: "ci-trigger", provider: PROVIDER, pipeline: pipeline, runId: result.runId },
    };
}

function formatRunSuffix(runId) { return runId === undefined || runId === null || runId === "" ? "" : ` with build id '${runId}'`; }

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
            correlationId: correlationId, stage: "emit", event: "ChatOpsEvent", errorCode: "CHILD_EXECUTION_STATUS_UNKNOWN",
            httpStatus: getHttpStatus(error), errorMessage: sanitizeLogText(error && error.message),
            invocationOutcome: "unknown", automaticRetry: "disabled",
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
    if (value === undefined || value === null || String(value).trim() === "") throw createRuleError("CONFIG_INVALID", `Pulse constant '${name}' is required.`);
    return String(value).trim();
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
    const wrapped = createRuleError(timedOut ? timeoutCode : requestCode,
        timedOut ? `The CI request did not respond within ${timeoutMs} ms.${formatCauseSuffix(cause)}` : `Unable to invoke the CI endpoint.${formatCauseSuffix(cause)}`, error);
    wrapped.requestTimeoutMs = timeoutMs;
    return wrapped;
}

function getSafeErrorFields(error) {
    const root = error && error.cause ? error.cause : error;
    return {
        errorCode: error && error.code, errorMessage: sanitizeLogText(error && error.message ? error.message : error),
        httpStatus: error && error.httpStatus || getHttpStatus(root), responseSummary: error && error.responseSummary,
        requestTimeoutMs: error && error.requestTimeoutMs, rootCauseCode: root && root !== error ? root.code : undefined,
    };
}

function normalizePulseExecutions(response) { if (Array.isArray(response)) return response; if (response && Array.isArray(response.data)) return response.data; return []; }
function summarizeResponseBody(value) { if (value === undefined || value === null) return ""; try { return sanitizeLogText(typeof value === "string" ? value : JSON.stringify(value)); } catch (error) { return sanitizeLogText(value); } }
function getCorrelationId(value) { if (value !== undefined && value !== null && String(value).trim()) return String(value).trim(); return require("crypto").randomUUID(); }
function getHttpStatus(error) { const status = error && error.response && (error.response.status || error.response.statusCode) || error && error.status; const parsed = Number(status); if (Number.isInteger(parsed)) return parsed; const match = String(error && error.message || "").match(/\b([45]\d{2})\b/); return match ? Number(match[1]) : undefined; }
function getJsonByteLength(value) { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch (error) { return undefined; } }
function firstPresent() { for (let index = 0; index < arguments.length; index += 1) { const value = arguments[index]; if (value !== undefined && value !== null && value !== "") return value; } return undefined; }
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

exports.escapeXmlAttribute = escapeXmlAttribute;
exports.getTeamCityBaseUrl = getTeamCityBaseUrl;
exports.normalizeBaseUrl = normalizeBaseUrl;
