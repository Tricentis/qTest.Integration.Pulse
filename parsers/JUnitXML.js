/**
 * Pulse usage: Parses JUnit-style XML delivered by delivery.js. Compatible
 * variants must expose the suite/case fields used by this implementation.
 * Input: A delivery envelope containing Base64 XML plus qTest project and
 * exactly one Test Cycle or Test Suite destination.
 * Constants: None.
 * Triggers: UpdateQTestWithResults is required; ChatOpsEvent is optional.
 * Output: Formatted qTest automation logs forwarded to the submission rule.
 * See parsers/README.md and delivery/README.md for wiring and limitations.
 */

import { Webhooks } from "@qasymphony/pulse-sdk";

const RULE_NAME = "JUnitXML";

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    const emitEvent = createEventEmitter(triggers, correlationId);

    try {
    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;
    let testLogs = [];

    let testResults = Buffer.from(payload.result, "base64").toString("utf8");

    let startTime = "";
    let endTime = "";
    let lastEndTime = 0;

    const result = await require("xml2js").parseStringPromise(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
            emptyTag: "...",
        });
    let processTestSuite = function (testsuite) {
                    lastEndTime = 0;
                    let suiteName = testsuite.$.name;
                    console.log("Suite Name: " + suiteName);
                    let testcases = Array.isArray(testsuite.testcase) ? testsuite.testcase : [testsuite.testcase];
                    testcases.forEach(function (testcase) {
                        let classArray = [];
                        classArray = testcase.$.name.replace("=>", ":").split(":");
                        let depth = classArray.length;
                        let className = classArray[depth - 1];
                        let moduleNames = classArray.slice(0, depth - 1).map((folder) => folder.trim());
                        if (moduleNames.length === 0) {
                            moduleNames.push(suiteName);
                        }
                        console.log("Case Name: " + className);
                        let classStatus = "passed";
                        startTime =
                            lastEndTime === 0 ? new Date(Date.parse(testsuite.$.timestamp)).toISOString() : lastEndTime;
                        let interim = new Date(Date.parse(startTime)).getSeconds() + parseFloat(testcase.$.time);
                        endTime = new Date(Date.parse(startTime)).setSeconds(interim);
                        endTime = new Date(endTime).toISOString();

                        let note = "";
                        let stack = "";
                        let processFailure = function (failure) {
                            if (failure) {
                                console.log(failure.$.type);
                                note = failure.$.type + ": " + failure.$.message;
                                stack = failure._;
                                classStatus = "failed";
                            }
                        };

                        let testFailure = Array.isArray(testcase.failure) ? testcase.failure : [testcase.failure];
                        testFailure.forEach(processFailure);

                        let testError = Array.isArray(testcase.error) ? testcase.error : [testcase.error];
                        testError.forEach(function (error) {
                            if (error) {
                                note = error.$.message;
                                classStatus = "failed";
                            }
                        });

                        let testSkipped = Array.isArray(testcase.skipped) ? testcase.skipped : [testcase.skipped];
                        testSkipped.forEach(function (skipped) {
                            if (skipped) {
                                classStatus = "skipped";
                            }
                        });

                        console.log(classStatus);

                        let testLog = {
                            status: classStatus,
                            name: className,
                            attachments: [],
                            note: note,
                            exe_start_date: startTime,
                            exe_end_date: endTime,
                            automation_content: htmlEntities(className),
                            module_names: moduleNames,
                        };

                        if (stack !== "") {
                            testLog.attachments.push({
                                name: `${className}.txt`,
                                data: Buffer.from(stack).toString("base64"),
                                content_type: "text/plain",
                            });
                        }
                        testLogs.push(testLog);
                        lastEndTime = endTime;
                    });
    };

    if (result.testsuites) {
                    let testsuites = Array.isArray(result.testsuites["testsuite"])
                        ? result.testsuites["testsuite"]
                        : [result.testsuites["testsuite"]];
                    testsuites.forEach(processTestSuite);
    } else {
                    console.log("Test Suites collection doesn't exist, checking for singular test suite.");
                    let testsuite = result.testsuite;
                    if (testsuite) {
                        processTestSuite(testsuite);
                    } else {
                        console.log("No Test Suite found, exiting.");
                    }
    }

    let formattedResults = {
        deliverySchemaVersion: payload.deliverySchemaVersion,
        correlationId: correlationId,
        projectId: projectId,
        targetType: payload.targetType,
        targetId: payload.targetId,
        testcycle: cycleId,
        testsuite: payload.testsuite,
        logs: testLogs,
    };

    writeLog("INFO", "JUnit results parsed successfully.", {
        correlationId: correlationId,
        stage: "parse",
        parsed: testLogs.length,
        durationMs: Date.now() - startedAt,
    });
    await emitEvent("UpdateQTestWithResults", formattedResults, { required: true });
    return formattedResults;
    } catch (error) {
        writeLog("ERROR", "Unable to process JUnit results.", {
            correlationId: correlationId,
            stage: "failed",
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            errorMessage: error && error.message,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            message: `[ERROR] correlationId=${correlationId} Unable to process JUnit results: ${error.message}`,
        });
        throw error;
    }
};

function createEventEmitter(triggers, correlationId) {
    return async function emitEvent(name, payload, options) {
        const required = Boolean(options && options.required);
        const trigger = (triggers || []).find((candidate) => candidate.name === name);
        if (!trigger) {
            const error = createParserError("TRIGGER_NOT_FOUND", `Webhook named '${name}' was not found.`);
            writeLog(required ? "ERROR" : "WARN", error.message, { correlationId, stage: "emit", event: name, errorCode: error.code });
            if (required) throw error;
            return [];
        }
        writeLog("INFO", "Invoking downstream Pulse event.", {
            correlationId, stage: "emit", event: name, emittedPayloadBytes: getJsonByteLength(payload),
        });
        try {
            const executions = normalizePulseExecutions(await new Webhooks().invoke(trigger, payload));
            if (executions.length === 0) {
                const unknownError = createUnknownPulseInvocationError(name);
                if (required) throw unknownError;
                writeLog("WARN", unknownError.message, Object.assign(
                    { correlationId, stage: "emit", event: name },
                    getPulseInvocationLogFields(unknownError, payload)
                ));
                return [];
            }
            executions.forEach((execution) => writeLog("INFO", "Downstream Pulse execution created.", {
                correlationId, stage: "emit", event: name,
                childExecutionId: execution && execution.id,
                childExecutionStatus: execution && execution.status,
            }));
            return executions;
        } catch (error) {
            const wrapped = error && error.code === "CHILD_EXECUTION_STATUS_UNKNOWN"
                ? error
                : createPulseInvocationError(name, error);
            writeLog(required ? "ERROR" : "WARN", wrapped.message, Object.assign(
                { correlationId, stage: "emit", event: name },
                getPulseInvocationLogFields(wrapped, payload)
            ));
            if (required) throw wrapped;
            return [];
        }
    };
}

function normalizePulseExecutions(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
}

function getCorrelationId(value) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    return require("crypto").randomUUID();
}

function createParserError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function createUnknownPulseInvocationError(name) {
    const error = createParserError(
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
    const error = createParserError(
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

function sanitizeLogText(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/(bearer\s+)[^\s,;"']+/gi, "$1[REDACTED]")
        .replace(/([?&](?:sig|token|api[_-]?key)=)[^&\s"']+/gi, "$1[REDACTED]")
        .replace(/\b(authorization|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi, "$1=[REDACTED]")
        .slice(0, 500);
}

function writeLog(level, message, fields) {
    const entries = Object.assign({ rule: RULE_NAME }, fields || {});
    const rendered = Object.keys(entries)
        .filter((key) => entries[key] !== undefined && entries[key] !== null && entries[key] !== "")
        .map((key) => `${key}=${JSON.stringify(sanitizeLogText(entries[key]))}`)
        .join(" ");
    const line = `[${level}] ${rendered} message=${JSON.stringify(sanitizeLogText(message))}`;
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
}
function htmlEntities(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
