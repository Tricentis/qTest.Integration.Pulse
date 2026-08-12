/**
 * Parses OpenText/Micro Focus/HP UFT run_results XML and emits the standard
 * UpdateQTestWithResults payload used by the Pulse rules in this repository.
 * 
 * qTest must have an active execution Status named "Warning" and an
 * Automation Settings mapping from incoming "Warning" to that status.
 * 
 * If you receive a 400 error from the auto-test-logs API, check the above.
 *
 * Input event:
 *   {
 *     deliverySchemaVersion: 2,
 *     correlationId: "optional-delivery-generated-id",
 *     projectId: "5",
 *     testcycle: "555555", // exactly one of testcycle or testsuite
 *     testsuite: "TS-555555",
 *     result: "base64-encoded UFT XML"
 *   }
 *
 * Constants: None.
 * Required Pulse trigger: UpdateQTestWithResults
 * Optional Pulse trigger: ChatOpsEvent
 */

const RULE_NAME = "UFTXML";
const MAX_LOG_VALUE_LENGTH = 500;

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const schemaVersion = body && body.deliverySchemaVersion ? body.deliverySchemaVersion : 1;
    const startedAt = Date.now();

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
            if (required) {
                throw error;
            }
            return [];
        }

        writeLog("INFO", "Invoking downstream Pulse event.", {
            correlationId: correlationId,
            stage: "emit",
            event: name,
            emittedPayloadBytes: getJsonByteLength(payload),
        });

        try {
            const { Webhooks } = require("@qasymphony/pulse-sdk");
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
            if (required) {
                throw wrappedError;
            }
            return [];
        }
    }

    try {
        validatePayload(body);
        const destination = getSubmissionDestination(body);

        writeLog("INFO", "Starting UFT result parsing.", {
            correlationId: correlationId,
            stage: "parse",
            schemaVersion: schemaVersion,
            sourceFormat: body.resultFormat || "xml",
            resultEncoding: body.resultEncoding || "base64",
            targetType: destination.targetType,
            targetId: destination.targetId,
            inputBytes: Buffer.byteLength(body.result, "base64"),
        });

        const testResults = decodeBase64Xml(body.result);
        const testLogs = await parseUftXml(testResults);
        const formattedResults = {
            deliverySchemaVersion: schemaVersion,
            correlationId: correlationId,
            projectId: body.projectId,
            targetType: destination.targetType,
            targetId: destination.targetId,
            logs: testLogs,
        };
        formattedResults[destination.payloadProperty] = destination.targetId;

        const statusCounts = summarizeStatuses(testLogs);
        writeLog("INFO", "UFT XML parsed successfully.", {
            correlationId: correlationId,
            stage: "parse",
            parsed: testLogs.length,
            passed: statusCounts.passed,
            failed: statusCounts.failed,
            warning: statusCounts.warning,
            durationMs: Date.now() - startedAt,
        });

        await emitEvent("UpdateQTestWithResults", formattedResults, { required: true });
        writeLog("INFO", "UFT result processing completed.", {
            correlationId: correlationId,
            stage: "complete",
            targetType: destination.targetType,
            targetId: destination.targetId,
            durationMs: Date.now() - startedAt,
        });
        return formattedResults;
    } catch (error) {
        const errorCode = error && error.code ? error.code : "PARSE_FAILED";
        writeLog("ERROR", "Unable to process UFT XML results.", Object.assign({
            correlationId: correlationId,
            stage: "failed",
            errorCode: errorCode,
            durationMs: Date.now() - startedAt,
        }, getSafeErrorFields(error)));

        if (findTrigger("ChatOpsEvent")) {
            await emitEvent("ChatOpsEvent", {
                correlationId: correlationId,
                errorCode: errorCode,
                message: `[ERROR] correlationId=${correlationId} Unable to process UFT XML results: ${error.message}`,
            });
        }
        throw error;
    }
};

async function parseUftXml(testResults) {
    if (typeof testResults !== "string" || testResults.trim() === "") {
        throw new Error("The UFT XML result is empty.");
    }

    const xml2js = require("xml2js");
    const parsed = await xml2js.parseStringPromise(testResults, {
        explicitArray: false,
        explicitChildren: false,
        preserveChildrenOrder: true,
        emptyTag: "",
    });

    if (!parsed || !parsed.Results) {
        throw new Error("The XML does not contain a UFT Results root element.");
    }

    const results = parsed.Results;
    const timezone = getText(results.GeneralInfo && results.GeneralInfo.Timezone);
    const testRuns = asArray(results.ReportNode).filter(
        (reportNode) => getNodeType(reportNode).toLowerCase() === "testrun"
    );

    if (testRuns.length === 0) {
        throw new Error("The UFT Results document does not contain a testrun ReportNode.");
    }

    return testRuns.map((testRun) => createTestLog(testRun, timezone));
}

function createTestLog(testRun, timezone) {
    const name = getDataText(testRun, "Name");
    if (!name) {
        throw new Error("A UFT testrun is missing Data/Name.");
    }

    const startDate = parseUftDate(getDataText(testRun, "StartTime"), timezone);
    const durationSeconds = parseDuration(getDataText(testRun, "Duration"));
    const endDate = new Date(startDate.getTime() + durationSeconds * 1000);
    const toolName = getDataText(testRun, "ToolName");
    const toolVersion = getDataText(testRun, "ToolVersionStringLiteral") || getDataText(testRun, "ToolVersion");

    return {
        status: mapUftStatus(getDataText(testRun, "Result")),
        name: name,
        attachments: [],
        note: [toolName, toolVersion].filter(Boolean).join(" "),
        exe_start_date: startDate.toISOString(),
        exe_end_date: endDate.toISOString(),
        automation_content: `uft:${name}`,
        module_names: ["UFT"],
        test_step_logs: collectTestSteps(testRun),
    };
}

function collectTestSteps(testRun) {
    const testSteps = [];

    function visit(reportNode, contextNames) {
        const type = getNodeType(reportNode).toLowerCase();
        const name = getDataText(reportNode, "Name");
        const uftStatus = getDataText(reportNode, "Result");
        const normalizedStatus = uftStatus.toLowerCase();
        const nextContextNames = type === "context" && name ? contextNames.concat(name) : contextNames;
        const isSemanticUserStep = type === "user";
        const isDiagnosticStep = type === "step" && !["done", "passed"].includes(normalizedStatus);

        if (isSemanticUserStep || isDiagnosticStep) {
            const order = testSteps.length + 1;
            const description =
                type === "step" && contextNames.length > 0
                    ? contextNames.concat(name || "Unnamed Step").join(" > ")
                    : name || "Unnamed Step";
            const detail =
                cleanDetailText(getDataText(reportNode, "ErrorText")) ||
                cleanDetailText(getDataText(reportNode, "Description")) ||
                uftStatus ||
                "No additional result detail was provided.";
            const snapshotReference = getSnapshotReference(reportNode);
            const actualResult = snapshotReference ? `${detail}\nSnapshot reference: ${snapshotReference}` : detail;
            const stackTrace = formatStackTrace(reportNode);
            const testStep = {
                description: description,
                expected_result: description,
                actual_result: actualResult,
                order: order,
                status: mapUftStatus(uftStatus),
            };

            if (stackTrace) {
                testStep.attachments = [
                    {
                        name: `uft-step-${order}-stacktrace.txt`,
                        data: Buffer.from(stackTrace, "utf8").toString("base64"),
                        content_type: "text/plain",
                    },
                ];
            }

            testSteps.push(testStep);
        }

        asArray(reportNode && reportNode.ReportNode).forEach((childNode) => visit(childNode, nextContextNames));
    }

    asArray(testRun && testRun.ReportNode).forEach((reportNode) => visit(reportNode, []));
    return testSteps;
}

function mapUftStatus(status) {
    switch (
        String(status || "")
            .trim()
            .toLowerCase()
    ) {
        case "passed":
        case "done":
        case "information":
            return "passed";
        case "failed":
            return "failed";
        case "warning":
            return "Warning";
        default:
            return "Warning";
    }
}

function parseUftDate(value, timezone) {
    const timestamp = String(value || "").trim();
    if (!timestamp) {
        throw new Error("A UFT testrun is missing Data/StartTime.");
    }

    const normalizedTimestamp = timestamp.replace(" ", "T");
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedTimestamp);
    const date = new Date(hasTimezone ? normalizedTimestamp : normalizedTimestamp + normalizeTimezone(timezone));

    if (Number.isNaN(date.getTime())) {
        throw new Error(`Unable to parse UFT timestamp '${timestamp}'.`);
    }

    return date;
}

function normalizeTimezone(timezone) {
    const value = String(timezone || "").trim();
    if (!value || value.toUpperCase() === "Z") {
        return "Z";
    }

    const match = value.match(/^([+-]\d{2}):(\d{2})(?::\d{2})?$/);
    return match ? `${match[1]}:${match[2]}` : "Z";
}

function parseDuration(value) {
    const duration = Number.parseFloat(value);
    return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function formatStackTrace(reportNode) {
    const data = getData(reportNode);
    const extension = data && data.Extension;
    const stackTrace = extension && extension.StackTrace;
    if (!stackTrace) {
        return "";
    }

    return asArray(stackTrace.StackFrame)
        .map((frame) => {
            const lines = [
                ["Module", getText(frame.ModuleName)],
                ["File", getText(frame.FileName)],
                ["Language", getText(frame.Language)],
                ["Function", getText(frame.FunctionName)],
                ["Script", getText(frame.Scripts)],
                ["Line", getText(frame.LineNo)],
            ]
                .filter((entry) => entry[1])
                .map((entry) => `${entry[0]}: ${entry[1]}`);
            return lines.join("\n");
        })
        .filter(Boolean)
        .join("\n\n");
}

function getSnapshotReference(reportNode) {
    const data = getData(reportNode);
    const snapshot = data && data.Snapshot;
    return snapshot && snapshot.$ ? getText(snapshot.$.reference) : "";
}

function getNodeType(reportNode) {
    return reportNode && reportNode.$ ? getText(reportNode.$.type) : "";
}

function getData(reportNode) {
    return reportNode && reportNode.Data ? asArray(reportNode.Data)[0] : undefined;
}

function getDataText(reportNode, propertyName) {
    const data = getData(reportNode);
    return data ? getText(data[propertyName]) : "";
}

function getText(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (Array.isArray(value)) {
        return getText(value[0]);
    }
    if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "_")) {
        return getText(value._);
    }
    if (typeof value === "object") {
        return "";
    }
    return String(value).trim();
}

function cleanDetailText(value) {
    return String(value || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .trim();
}

function asArray(value) {
    if (value === undefined || value === null || value === "") {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function validatePayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw createRuleError("CONTRACT_INVALID", "The Pulse event payload is missing.");
    }

    ["projectId", "result"].forEach((propertyName) => {
        if (payload[propertyName] === undefined || payload[propertyName] === null || payload[propertyName] === "") {
            throw createRuleError("CONTRACT_INVALID", `The Pulse event payload is missing '${propertyName}'.`);
        }
    });

    if (typeof payload.result !== "string") {
        throw createRuleError("CONTRACT_INVALID", "The UFT 'result' must be a Base64 string.");
    }
    if (payload.resultFormat && String(payload.resultFormat).toLowerCase() !== "xml") {
        throw createRuleError("CONTRACT_INVALID", "The UFT parser only accepts XML results.");
    }
    if (payload.resultEncoding && String(payload.resultEncoding).toLowerCase() !== "base64") {
        throw createRuleError("CONTRACT_INVALID", "The UFT parser only accepts Base64-encoded XML results.");
    }

    getSubmissionDestination(payload);
}

function getSubmissionDestination(payload) {
    const testCycle = firstPresent(payload && payload.testcycle, payload && payload.test_cycle, payload && payload.testCycle);
    const testSuite = firstPresent(payload && payload.testsuite, payload && payload.test_suite, payload && payload.testSuite);
    const hasTestCycle = testCycle !== undefined;
    const hasTestSuite = testSuite !== undefined;

    if (hasTestCycle === hasTestSuite) {
        throw createRuleError(
            "TARGET_INVALID",
            "The Pulse event payload must provide exactly one of 'testcycle' or 'testsuite'."
        );
    }

    const targetType = hasTestSuite ? "test-suite" : "test-cycle";
    return {
        targetType: targetType,
        targetId: hasTestSuite ? testSuite : testCycle,
        payloadProperty: hasTestSuite ? "testsuite" : "testcycle",
    };
}

function firstPresent() {
    for (let index = 0; index < arguments.length; index += 1) {
        const value = arguments[index];
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return undefined;
}

function decodeBase64Xml(value) {
    const normalized = String(value || "").replace(/\s+/g, "");

    if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
        throw createRuleError("DECODE_FAILED", "The UFT result is not valid Base64.");
    }

    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    if (!decoded.trim()) {
        throw createRuleError("DECODE_FAILED", "The decoded UFT XML result is empty.");
    }
    return decoded;
}

function normalizePulseExecutions(response) {
    if (Array.isArray(response)) {
        return response;
    }
    if (response && Array.isArray(response.data)) {
        return response.data;
    }
    return [];
}

function summarizeStatuses(testLogs) {
    return testLogs.reduce(
        (counts, testLog) => {
            const status = String(testLog && testLog.status || "").toLowerCase();
            if (status === "passed") counts.passed += 1;
            else if (status === "failed") counts.failed += 1;
            else counts.warning += 1;
            return counts;
        },
        { passed: 0, failed: 0, warning: 0 }
    );
}

function getCorrelationId(value) {
    if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
    }
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
        error && error.response && (error.response.status || error.response.statusCode) ||
        error && (error.statusCode || error.status);
    const parsedStatus = Number(explicitStatus);
    if (Number.isInteger(parsedStatus)) return parsedStatus;

    const match = String(error && error.message || "").match(/\b([45]\d{2})\b/);
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
    return {
        errorCode: error && error.code,
        errorMessage: sanitizeLogText(error && error.message ? error.message : String(error)),
        httpStatus: error && error.httpStatus || getHttpStatus(error && error.cause || error),
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
    const limited = sanitizeLogText(rendered);
    return JSON.stringify(limited);
}

exports.parseUftXml = parseUftXml;
exports.mapUftStatus = mapUftStatus;
exports.parseUftDate = parseUftDate;
exports.decodeBase64Xml = decodeBase64Xml;
exports.getSubmissionDestination = getSubmissionDestination;
exports.normalizePulseExecutions = normalizePulseExecutions;
