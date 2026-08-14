/**
 * Pulse usage: Receives a SonarQube project-analysis webhook directly. Do not
 * send this Action a delivery.js envelope.
 * Input: SonarQube webhook JSON with qualityGate.conditions.
 * Constants: QTEST_PROJECT_ID (ProjectID alias supported), QTEST_TARGET_TYPE,
 * and QTEST_TARGET_ID; source defaults remain available for compatibility.
 * Triggers: UpdateQTestWithResults is required; ChatOpsEvent is optional.
 * Output: Quality-gate conditions formatted as qTest automation logs.
 * See parsers/README.md for destination configuration.
 */

const { Webhooks } = require("@qasymphony/pulse-sdk");

const RULE_NAME = "SonarQubeJSON";

// Direct SonarQube webhooks do not contain a qTest destination. Set these
// values in the parser source or provide the Pulse constants listed below.
const DEFAULT_QTEST_DESTINATION = {
    projectId: "",
    targetType: "test-suite", // test-cycle or test-suite
    targetId: "",
};

/*
 * Preferred Pulse constants (override DEFAULT_QTEST_DESTINATION):
 *   QTEST_PROJECT_ID
 *   QTEST_TARGET_TYPE: test-cycle or test-suite
 *   QTEST_TARGET_ID
 *
 * Required Pulse trigger: UpdateQTestWithResults
 * Optional Pulse trigger: ChatOpsEvent
 *
 * The handler accepts a raw SonarQube webhook. For backward compatibility it
 * also accepts the former wrapper with projectId/destination fields and a
 * string or object in event.result.
 */
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    const correlationId = getCorrelationId(body && body.correlationId);
    const startedAt = Date.now();

    function findTrigger(name) {
        return (triggers || []).find((trigger) => trigger.name === name);
    }

    async function emitEvent(name, payload, options) {
        const required = Boolean(options && options.required);
        const trigger = findTrigger(name);

        if (!trigger) {
            const error = createParserError("TRIGGER_NOT_FOUND", `Webhook named '${name}' was not found.`);
            writeLog(required ? "ERROR" : "WARN", error.message, {
                correlationId: correlationId,
                stage: "emit",
                event: name,
                errorCode: error.code,
            });
            if (required) throw error;
            return [];
        }

        writeLog("INFO", "Invoking downstream Pulse event.", {
            correlationId: correlationId,
            stage: "emit",
            event: name,
            emittedPayloadBytes: getJsonByteLength(payload),
        });

        try {
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
            const wrapped = error && error.code === "CHILD_EXECUTION_STATUS_UNKNOWN"
                ? error
                : createPulseInvocationError(name, error);
            writeLog(required ? "ERROR" : "WARN", wrapped.message, Object.assign({
                correlationId: correlationId,
                stage: "emit",
                event: name,
            }, getPulseInvocationLogFields(wrapped, payload)));
            if (required) throw wrapped;
            return [];
        }
    }

    try {
        const sonarResult = extractSonarResult(body);
        validateSonarResult(sonarResult);
        const destination = resolveQTestDestination(body, constants);
        const testLogs = buildTestLogs(sonarResult);
        if (testLogs.length === 0) {
            throw createParserError(
                "NO_RESULTS",
                "The SonarQube webhook does not contain any quality gate conditions to submit."
            );
        }
        const formattedResults = {
            deliverySchemaVersion: body && body.deliverySchemaVersion,
            correlationId: correlationId,
            projectId: destination.projectId,
            targetType: destination.targetType,
            targetId: destination.targetId,
            logs: testLogs,
        };
        formattedResults[destination.payloadProperty] = destination.targetId;

        writeLog("INFO", "SonarQube webhook parsed successfully.", {
            correlationId: correlationId,
            stage: "parse",
            targetType: destination.targetType,
            targetId: destination.targetId,
            parsed: testLogs.length,
            durationMs: Date.now() - startedAt,
        });

        await emitEvent("UpdateQTestWithResults", formattedResults, { required: true });
        return formattedResults;
    } catch (error) {
        const errorCode = error && error.code ? error.code : "PARSE_FAILED";
        writeLog("ERROR", "Unable to process the SonarQube webhook.", {
            correlationId: correlationId,
            stage: "failed",
            errorCode: errorCode,
            errorMessage: error && error.message,
            durationMs: Date.now() - startedAt,
        });
        await emitEvent("ChatOpsEvent", {
            correlationId: correlationId,
            errorCode: errorCode,
            message: `[ERROR] correlationId=${correlationId} Unable to process SonarQube results: ${error.message}`,
        });
        throw error;
    }
};

function extractSonarResult(body) {
    if (!body || typeof body !== "object") {
        throw createParserError("CONTRACT_INVALID", "The SonarQube webhook payload is missing.");
    }

    if (body.result !== undefined && body.result !== null) {
        if (typeof body.result === "string") {
            try {
                return JSON.parse(body.result);
            } catch (error) {
                throw createParserError("PARSE_FAILED", "The wrapped SonarQube result is not valid JSON.", error);
            }
        }
        if (typeof body.result === "object") return body.result;
        throw createParserError("CONTRACT_INVALID", "The wrapped SonarQube result must be JSON text or an object.");
    }

    return body;
}

function validateSonarResult(result) {
    if (!result.project || !firstPresent(result.project.name, result.project.key)) {
        throw createParserError("CONTRACT_INVALID", "The SonarQube webhook is missing project information.");
    }
    if (!result.qualityGate || !Array.isArray(result.qualityGate.conditions)) {
        throw createParserError("CONTRACT_INVALID", "The SonarQube webhook is missing qualityGate.conditions.");
    }
    if (!result.analysedAt) {
        throw createParserError("CONTRACT_INVALID", "The SonarQube webhook is missing 'analysedAt'.");
    }
}

function resolveQTestDestination(body, constants) {
    const projectId = firstPresent(
        body && body.projectId,
        constants && constants.QTEST_PROJECT_ID,
        constants && constants.ProjectID,
        DEFAULT_QTEST_DESTINATION.projectId
    );
    if (!isPresent(projectId)) {
        throw createParserError(
            "CONFIG_INVALID",
            "Configure qTest project id with QTEST_PROJECT_ID or DEFAULT_QTEST_DESTINATION.projectId."
        );
    }

    const eventTestCycle = firstPresent(body && body.testcycle, body && body.test_cycle, body && body.testCycle);
    const eventTestSuite = firstPresent(body && body.testsuite, body && body.test_suite, body && body.testSuite);
    if (isPresent(eventTestCycle) && isPresent(eventTestSuite)) {
        throw createParserError("TARGET_INVALID", "The SonarQube wrapper cannot contain both Test Cycle and Test Suite.");
    }

    const configuredType = firstPresent(
        body && body.targetType,
        isPresent(eventTestSuite) ? "test-suite" : undefined,
        isPresent(eventTestCycle) ? "test-cycle" : undefined,
        constants && constants.QTEST_TARGET_TYPE,
        DEFAULT_QTEST_DESTINATION.targetType
    );
    const targetType = normalizeTargetType(configuredType);
    const configuredId = firstPresent(
        body && body.targetId,
        targetType === "test-suite" ? eventTestSuite : eventTestCycle,
        constants && constants.QTEST_TARGET_ID,
        DEFAULT_QTEST_DESTINATION.targetId
    );

    if (!isPresent(configuredId)) {
        throw createParserError(
            "CONFIG_INVALID",
            "Configure qTest target id with QTEST_TARGET_ID or DEFAULT_QTEST_DESTINATION.targetId."
        );
    }

    if (targetType === "test-suite" && isPresent(eventTestCycle)) {
        throw createParserError("TARGET_INVALID", "The SonarQube target type conflicts with the Test Cycle field.");
    }
    if (targetType === "test-cycle" && isPresent(eventTestSuite)) {
        throw createParserError("TARGET_INVALID", "The SonarQube target type conflicts with the Test Suite field.");
    }

    return {
        projectId: String(projectId).trim(),
        targetType: targetType,
        targetId: String(configuredId).trim(),
        payloadProperty: targetType === "test-suite" ? "testsuite" : "testcycle",
    };
}

function buildTestLogs(testResults) {
    const moduleName = firstPresent(testResults.project.name, testResults.project.key);
    const endDate = testResults.changedAt || testResults.analysedAt;

    return testResults.qualityGate.conditions.map((condition) => {
        const mappedStatus = mapSonarStatus(condition.status);
        const operator = condition.operator === "LESS_THAN"
            ? " > "
            : condition.operator === "GREATER_THAN"
                ? " < "
                : " ";
        const metric = condition.metric || "Unnamed SonarQube condition";

        return {
            exe_start_date: testResults.analysedAt,
            exe_end_date: endDate,
            module_names: [moduleName],
            name: metric,
            automation_content: `${testResults.taskId || "sonarqube"}#${moduleName}#${metric}`,
            properties: [],
            description: moduleName,
            status: mappedStatus,
            featureName: metric,
            test_step_logs: [
                {
                    order: 1,
                    description: metric,
                    expected_result: `${operator}${condition.errorThreshold ?? ""}`.trim(),
                    actual_result: condition.value,
                    status: mappedStatus,
                },
            ],
        };
    });
}

function mapSonarStatus(status) {
    const normalized = String(status || "").trim().toUpperCase();
    if (normalized === "OK" || normalized === "PASS") return "PASS";
    return "FAIL";
}

function normalizeTargetType(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["test-cycle", "testcycle", "cycle"].includes(normalized)) return "test-cycle";
    if (["test-suite", "testsuite", "suite"].includes(normalized)) return "test-suite";
    throw createParserError(
        "TARGET_INVALID",
        `Unsupported qTest target type '${value}'. Expected 'test-cycle' or 'test-suite'.`
    );
}

function firstPresent() {
    for (let index = 0; index < arguments.length; index += 1) {
        if (isPresent(arguments[index])) return arguments[index];
    }
    return undefined;
}

function isPresent(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizePulseExecutions(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
}

function getCorrelationId(value) {
    if (isPresent(value)) return String(value).trim();
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
        .replace(
            /\b(authorization|token|api[_-]?key|password|secret|sig)\s*[:=]\s*[^\s,;&"']+/gi,
            "$1=[REDACTED]"
        )
        .slice(0, 500);
}

function writeLog(level, message, fields) {
    const entries = Object.assign({ rule: RULE_NAME }, fields || {});
    const context = Object.keys(entries)
        .filter((key) => entries[key] !== undefined && entries[key] !== null && entries[key] !== "")
        .map((key) => `${key}=${JSON.stringify(sanitizeLogText(entries[key]))}`)
        .join(" ");
    const line = `[${level}] ${context} message=${JSON.stringify(sanitizeLogText(message))}`;

    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
}

exports.buildTestLogs = buildTestLogs;
exports.extractSonarResult = extractSonarResult;
exports.resolveQTestDestination = resolveQTestDestination;
