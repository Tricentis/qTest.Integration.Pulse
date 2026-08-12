/**
 * Usage: Run from a current Node.js LTS environment after configuring the
 * parser webhook, qTest project/destination, result path, and optional command.
 * Input: A JSON, XML, or TRX result file on disk.
 * Dependencies: Node.js built-ins only; no npm installation is performed.
 * Output: Delivery contract v2 posted to the configured Pulse parser webhook.
 * JSON remains native; XML/TRX is Base64-encoded from the original bytes.
 * See delivery/README.md before placing this script in a CI workspace.
 */

const cp = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs").promises;
const path = require("path");

const DELIVERY_SCHEMA_VERSION = 2;
const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120000;

const JSON_EXTENSIONS = new Set([".json"]);
const XML_EXTENSIONS = new Set([".xml", ".trx"]);

const formatSizeUnits = (bytes) => (bytes / 1048576).toFixed(4);

const execCommand = (command) => {
    console.log("=== [INFO] executing command:", command, "===");
    cp.execSync(command, { stdio: "inherit" });
    console.log("=== [INFO] execution completed ===");
};

const removeUtf8Bom = (text) => {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

const detectResultFormat = (resultsPath, resultBuffer, configuredFormat) => {
    const requestedFormat = configuredFormat.toLowerCase();

    if (requestedFormat === "json" || requestedFormat === "xml") {
        return requestedFormat;
    }

    if (requestedFormat !== "auto") {
        throw new Error(
            `Unsupported result format '${configuredFormat}'. Expected 'auto', 'json', or 'xml'.`
        );
    }

    const extension = path.extname(resultsPath).toLowerCase();

    if (JSON_EXTENSIONS.has(extension)) {
        return "json";
    }

    if (XML_EXTENSIONS.has(extension)) {
        return "xml";
    }

    const content = removeUtf8Bom(resultBuffer.toString("utf8")).trimStart();

    if (content.startsWith("{") || content.startsWith("[")) {
        return "json";
    }

    if (content.startsWith("<")) {
        return "xml";
    }

    throw new Error(
        `Unable to determine the result format for '${resultsPath}'. ` +
            "Set resultFormat explicitly to 'json' or 'xml'."
    );
};

const prepareResult = (resultFormat, resultBuffer) => {
    if (resultFormat === "json") {
        const jsonText = removeUtf8Bom(resultBuffer.toString("utf8"));

        try {
            return {
                resultEncoding: "identity",
                result: JSON.parse(jsonText),
            };
        } catch (error) {
            throw new Error(`Result file contains invalid JSON: ${error.message}`);
        }
    }

    return {
        resultEncoding: "base64",
        result: resultBuffer.toString("base64"),
    };
};

const normalizeTargetType = (targetType) => {
    const normalized = String(targetType || "").trim().toLowerCase();

    if (["test-cycle", "testcycle", "cycle"].includes(normalized)) {
        return "test-cycle";
    }

    if (["test-suite", "testsuite", "suite"].includes(normalized)) {
        return "test-suite";
    }

    throw new Error(
        `Unsupported targetType '${targetType}'. Expected 'test-cycle' or 'test-suite'.`
    );
};

const createTargetPayload = (targetType, targetId) => {
    const normalizedTargetType = normalizeTargetType(targetType);

    if (targetId === "" || targetId === undefined || targetId === null) {
        throw new Error("targetId must be configured.");
    }

    const targetPayload = {
        targetType: normalizedTargetType,
        targetId,
    };

    if (normalizedTargetType === "test-suite") {
        targetPayload.testsuite = targetId;
    } else {
        targetPayload.testcycle = targetId;
    }

    return targetPayload;
};

const validateConfiguration = ({ pulseUri, projectId, targetType, targetId }) => {
    if (!pulseUri) {
        throw new Error("pulseUri must be configured.");
    }

    let parsedUri;

    try {
        parsedUri = new URL(pulseUri);
    } catch {
        throw new Error("pulseUri must be a valid HTTP or HTTPS URL.");
    }

    if (!["http:", "https:"].includes(parsedUri.protocol)) {
        throw new Error("pulseUri must use HTTP or HTTPS.");
    }

    if (projectId === "" || projectId === undefined || projectId === null) {
        throw new Error("projectId must be configured.");
    }

    createTargetPayload(targetType, targetId);
};

const parseResponseBody = async (response) => {
    const responseText = await response.text();

    if (!responseText) {
        return null;
    }

    try {
        return JSON.parse(responseText);
    } catch {
        return responseText;
    }
};

const summarizeResponseBody = (responseBody) => {
    const summary = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
    return summary.length > 2000 ? `${summary.slice(0, 2000)}...` : summary;
};

const postPayload = async (pulseUri, payloadJson, timeoutMs = REQUEST_TIMEOUT_MS) => {
    const response = await fetch(pulseUri, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: payloadJson,
        signal: AbortSignal.timeout(timeoutMs),
    });
    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
        throw new Error(
            `Result upload failed with HTTP ${response.status}: ${summarizeResponseBody(responseBody)}`
        );
    }

    return responseBody;
};

const main = async () => {
    // Configuration Section
    const pulseUri = ""; // Pulse parser webhook endpoint
    const projectId = ""; // Target qTest Project ID
    const targetType = "test-cycle"; // test-cycle or test-suite
    const targetId = ""; // Target qTest Test Cycle or Test Suite ID/PID
    const command = ""; // CLI execution command, leave empty if not required
    const resultsPath = "C:\\path\\to\\results\\filename.ext";
    const resultFormat = "auto"; // auto, json, or xml
    // End Configuration Section

    validateConfiguration({ pulseUri, projectId, targetType, targetId });

    if (command !== "") {
        try {
            execCommand(command);
        } catch (error) {
            throw new Error(`Test command failed: ${error.message}`);
        }
    }

    let resultBuffer;

    try {
        resultBuffer = await fs.readFile(resultsPath);
        console.log("=== [INFO] read results file successfully ===");
    } catch (error) {
        throw new Error(`Unable to read result file: ${error.message}`);
    }

    const detectedResultFormat = detectResultFormat(resultsPath, resultBuffer, resultFormat);
    const preparedResult = prepareResult(detectedResultFormat, resultBuffer);
    const targetPayload = createTargetPayload(targetType, targetId);
    const correlationId = randomUUID();
    const payloadBody = {
        deliverySchemaVersion: DELIVERY_SCHEMA_VERSION,
        correlationId,
        projectId,
        ...targetPayload,
        resultFormat: detectedResultFormat,
        resultEncoding: preparedResult.resultEncoding,
        result: preparedResult.result,
    };

    const payloadJson = JSON.stringify(payloadBody);
    const payloadBytes = Buffer.byteLength(payloadJson, "utf8");

    console.log(
        `=== [INFO] detected ${detectedResultFormat}; ` +
            `encoding ${preparedResult.resultEncoding}; ` +
            `target ${targetPayload.targetType} ${targetPayload.targetId}; ` +
            `payload size ${formatSizeUnits(payloadBytes)} MB; ` +
            `correlation id ${correlationId} ===`
    );

    if (payloadBytes > MAX_PAYLOAD_BYTES) {
        throw new Error(
            `Payload size ${formatSizeUnits(payloadBytes)} MB exceeds ` +
                `${formatSizeUnits(MAX_PAYLOAD_BYTES)} MB.`
        );
    }

    console.log("=== [INFO] uploading results... ===");

    const responseBody = await postPayload(pulseUri, payloadJson);

    const executions = Array.isArray(responseBody) ? responseBody : [responseBody];

    for (const execution of executions) {
        if (execution && typeof execution === "object") {
            console.log(
                `=== [INFO] status: ${execution.status ?? "unknown"}, ` +
                    `execution id: ${execution.id ?? "unknown"}, ` +
                    `correlation id: ${correlationId} ===`
            );
        } else if (execution !== null) {
            console.log(`=== [INFO] response: ${execution} ===`);
        }
    }

    console.log(
        "=== [INFO] Pulse accepted the delivery; parser and downstream qTest processing continue asynchronously ==="
    );
};

module.exports = {
    createTargetPayload,
    detectResultFormat,
    normalizeTargetType,
    postPayload,
    prepareResult,
    validateConfiguration,
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`=== [ERROR] ${error.message} ===`);
        process.exitCode = 1;
    });
}
