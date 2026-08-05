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
 *     projectId: "5",
 *     testcycle: "555555",
 *     result: "base64-encoded UFT XML"
 *   }
 *
 * Required Pulse trigger: UpdateQTestWithResults
 * Optional Pulse trigger: ChatOpsEvent
 * Optional API submission status trigger: CheckProcessingQueue
 */

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function findTrigger(name) {
        return (triggers || []).find((trigger) => trigger.name === name);
    }

    function emitEvent(name, payload) {
        const trigger = findTrigger(name);
        if (!trigger) {
            console.error(`[ERROR]: (emitEvent) Webhook named '${name}' not found.`);
            return Promise.resolve();
        }

        const { Webhooks } = require("@qasymphony/pulse-sdk");
        return new Webhooks().invoke(trigger, payload);
    }

    try {
        validatePayload(body);

        const testResults = Buffer.from(body.result, "base64").toString("utf8");
        const testLogs = await parseUftXml(testResults);
        const formattedResults = {
            projectId: body.projectId,
            testcycle: body.testcycle,
            logs: testLogs,
        };

        if (!findTrigger("UpdateQTestWithResults")) {
            throw new Error("Required webhook named 'UpdateQTestWithResults' was not found.");
        }

        console.log(`[INFO]: UFT XML successfully parsed into ${testLogs.length} test log(s).`);
        await emitEvent("UpdateQTestWithResults", formattedResults);
        return formattedResults;
    } catch (error) {
        console.error(`[ERROR]: Unable to process UFT XML results - ${error.message}`);
        if (findTrigger("ChatOpsEvent")) {
            await emitEvent("ChatOpsEvent", {
                message: `[ERROR]: Unable to process UFT XML results - ${error.message}`,
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
        throw new Error("The Pulse event payload is missing.");
    }

    ["projectId", "testcycle", "result"].forEach((propertyName) => {
        if (payload[propertyName] === undefined || payload[propertyName] === null || payload[propertyName] === "") {
            throw new Error(`The Pulse event payload is missing '${propertyName}'.`);
        }
    });
}

exports.parseUftXml = parseUftXml;
exports.mapUftStatus = mapUftStatus;
exports.parseUftDate = parseUftDate;
