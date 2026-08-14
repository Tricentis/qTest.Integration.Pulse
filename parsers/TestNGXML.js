/**
 * Pulse usage: Parses TestNG XML results delivered by delivery.js.
 * Input: A delivery envelope containing Base64 XML plus qTest project and
 * exactly one Test Cycle or Test Suite destination.
 * Constants: None.
 * Triggers: UpdateQTestWithResults is required; ChatOpsEvent is optional.
 * Output: Formatted qTest automation logs forwarded to the submission rule.
 * See parsers/README.md and delivery/README.md for wiring and limitations.
 */

import xml2js from "xml2js";
import { Webhooks } from "@qasymphony/pulse-sdk";

const RULE_NAME = "TestNGXML";

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();
    const emitEvent = createEventEmitter(triggers, correlationId);

    function convertUTCToISO(utcTimestamp) {
        // Replace ' UTC' with 'Z' to convert to ISO 8601 format
        const isoTimestamp = utcTimestamp.replace(" UTC", "Z");
        return new Date(isoTimestamp).toISOString();
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    try {
    let payload = body;
    let projectId = payload.projectId;
    let cycleId = payload.testcycle;

    let testResults = Buffer.from(payload.result, "base64").toString("utf8");

    const result = await xml2js.parseStringPromise(testResults, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false,
        });

            let topLevel = result["testng-results"].suite.$.name;
            console.log("[INFO]: Top Level Name: ", topLevel);

            // Check if 'suite' and 'test' arrays exist
            if (!result["testng-results"].suite || !result["testng-results"].suite.test) {
                console.log("[INFO]: No test suites found.");
                return;
            }

            let testSuites = Array.isArray(result["testng-results"].suite.test)
                ? result["testng-results"].suite.test
                : [result["testng-results"].suite.test];

            console.log(`[INFO]: Processing ${testSuites.length} test suites.`);

            for (const ts of testSuites) {
                let suiteName = ts.$.name;
                console.log("[INFO]: Suite Name: ", suiteName);

                // Check if 'class' array exists
                if (!ts.class) {
                    console.log("[INFO]: No test cases found in suite: ", suiteName);
                    continue;
                }

                let testClasses = Array.isArray(ts.class) ? ts.class : [ts.class];
                console.log(`[INFO]: Processing ${testClasses.length} test cases.`);
                let testLogs = [];

                for (const tc of testClasses) {
                    let className = tc.$.name;
                    console.log("[INFO]: Class Name: ", className);
                    let methodStatus;
                    testLogs = [];
                    let testSteps = [];
                    let order = 0;

                    // Check if 'test-method' array exists
                    if (!tc["test-method"]) {
                        console.log("[INFO]: No test methods found in class: ", className);
                        continue;
                    }

                    // Below is an all-lowercase array of housekeeping methods that should not have results recorded in qTest.
                    const invalidMethods = [
                        "endtest",
                        "setup",
                        "suitesetup",
                        "beforesuite",
                        "aftermethod",
                        "beforemethod",
                        "beforetest",
                        "beforeclass",
                        "afterclass",
                        "aftersuite",
                        "aftertest",
                        "testbreakdown",
                        "reset",
                        "teardown",
                    ];
                    let testMethods = Array.isArray(tc["test-method"]) ? tc["test-method"] : [tc["test-method"]];
                    console.log(`[INFO]: Processing ${testMethods.length} test methods.`);

                    for (const tm of testMethods) {
                        let methodName = tm.$.name;
                        if (!invalidMethods.includes(methodName.toLowerCase())) {
                            testSteps = [];
                            console.log("[INFO]: Method Name: ", methodName);
                            methodStatus = tm.$.status;
                            let automationContent = `${className}-${methodName}`;
                            let exe_start_date = convertUTCToISO(tm.$["started-at"]);
                            let exe_end_date = convertUTCToISO(tm.$["finished-at"]);
                            let methodDescription = tm.description || methodName;
                            let stackMessage;
                            let stackException;
                            let paramList = [];
                            let encodedMethodAttachment;

                            // Flatten the params structure into a plaintext list of params
                            if (tm.params && tm.params.param) {
                                let paramArray = Array.isArray(tm.params.param) ? tm.params.param : [tm.params.param];
                                console.log(`[INFO]: Processing ${paramArray.length} parameters.`);
                                paramArray.forEach((param) => {
                                    paramList.push(
                                        typeof param.value === "object"
                                            ? JSON.stringify(param.value)
                                            : param.value.trim()
                                    );
                                });
                                paramList = "_" + paramList.join("-");
                                automationContent += paramList; // Append the params to the automation content
                            }

                            let stepLog = {
                                order: order,
                                exe_date: exe_start_date,
                                description: methodName,
                                expected_result: methodName,
                                actual_result: methodName,
                                status: methodStatus,
                            };

                            testSteps.push(stepLog);

                            let testLog = {
                                status: methodStatus,
                                name: methodName,
                                attachments: [],
                                exe_start_date: exe_start_date,
                                exe_end_date: exe_end_date,
                                automation_content: automationContent,
                                note: methodDescription,
                                module_names: [topLevel, suiteName, className],
                                test_step_logs: testSteps,
                                attachments: [],
                            };

                            if (methodStatus == "FAIL") {
                                stackMessage = tm.exception.message;
                                stackException = tm.exception["full-stacktrace"];
                                let methodAttachment = `Message:\n${stackMessage}\n\nStack Trace:\n${stackException}`;
                                encodedMethodAttachment = Buffer.from(methodAttachment, "utf-8").toString("base64");
                                testLog.attachments.push({
                                    name: `stack-trace-${methodName}-${exe_start_date
                                        .toString()
                                        .replace(/:/g, "-")}.txt`,
                                    content_type: "text/plain",
                                    data: encodedMethodAttachment,
                                });
                            }

                            testLogs.push(testLog);
                        } else {
                            console.log(`[INFO]: ${methodName} is a housekeeping task and is not a valid test result.`);
                        }
                    }

                    if (testLogs.length > 0) {
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

                        await emitEvent("UpdateQTestWithResults", formattedResults, { required: true });
                        await sleep(2000); // Sleep for 2 seconds after each test class
                    } else {
                        console.log(
                            "[INFO] Class had 0 valid test methods (likely all housekeeping tasks), skipping..."
                        );
                    }
                }
            }
    writeLog("INFO", "TestNG results parsed and submitted successfully.", {
        correlationId: correlationId,
        stage: "complete",
        durationMs: Date.now() - startedAt,
    });
    } catch (error) {
        writeLog("ERROR", "Unable to process TestNG results.", {
            correlationId: correlationId,
            stage: "failed",
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            errorMessage: error && error.message,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: error && error.code ? error.code : "PARSE_FAILED",
            message: `[ERROR] correlationId=${correlationId} Unable to process TestNG results: ${error.message}`,
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
    // Pulse QuickJS does not expose Node crypto; this identifier is for correlation, not security.
    let timestamp = Date.now();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
        const randomNibble = (timestamp + Math.floor(Math.random() * 16)) % 16;
        timestamp = Math.floor(timestamp / 16);
        return (character === "x" ? randomNibble : (randomNibble & 3) | 8).toString(16);
    });
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
