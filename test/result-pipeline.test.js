const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const deliveryPath = path.join(repositoryRoot, "delivery", "node.js", "delivery.js");
const uftPath = path.join(repositoryRoot, "parsers", "UFTXML.js");
const cypressPath = path.join(repositoryRoot, "parsers", "CypressMochawesomeJSON.js");
const junitPath = path.join(repositoryRoot, "parsers", "JUnitXML.js");
const postmanPath = path.join(repositoryRoot, "parsers", "PostmanJSON.js");
const sonarPath = path.join(repositoryRoot, "parsers", "SonarQubeJSON.js");
const submissionPath = path.join(repositoryRoot, "qtest", "UpdateQTestWithResults.js");
const queuePath = path.join(repositoryRoot, "qtest", "CheckProcessingQueue.js");
const uftFixture = readFileSync(path.join(__dirname, "fixtures", "uft-warning.xml"), "utf8");

function loadFresh(modulePath) {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
}

function loadMarketplaceParser(modulePath) {
    const source = readFileSync(modulePath, "utf8")
        .replace(
            /import\s+\{\s*Webhooks\s*\}\s+from\s+["']@qasymphony\/pulse-sdk["'];?/,
            'const { Webhooks } = require("@qasymphony/pulse-sdk");'
        )
        .replace(/import\s+xml2js\s+from\s+["']xml2js["'];?/, 'const xml2js = require("xml2js");');
    const loadedModule = new Module(modulePath, module);
    loadedModule.filename = modulePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(modulePath));
    loadedModule._compile(source, modulePath);
    return loadedModule.exports;
}

async function withModuleMocks(mocks, callback) {
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) {
            return mocks[request];
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return await callback();
    } finally {
        Module._load = originalLoad;
    }
}

async function captureConsole(callback) {
    const original = {
        log: console.log,
        warn: console.warn,
        error: console.error,
    };
    const lines = [];

    console.log = (...values) => lines.push(`[log] ${values.join(" ")}`);
    console.warn = (...values) => lines.push(`[warn] ${values.join(" ")}`);
    console.error = (...values) => lines.push(`[error] ${values.join(" ")}`);

    try {
        const result = await callback();
        return { result: result, lines: lines };
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    }
}

test("delivery constructs an exclusive Test Cycle target", { concurrency: false }, () => {
    const delivery = loadFresh(deliveryPath);
    const target = delivery.createTargetPayload("test-cycle", "TC-123");

    assert.deepEqual(target, {
        targetType: "test-cycle",
        targetId: "TC-123",
        testcycle: "TC-123",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(target, "testsuite"), false);
});

test("delivery constructs an exclusive Test Suite target", { concurrency: false }, () => {
    const delivery = loadFresh(deliveryPath);
    const target = delivery.createTargetPayload("test-suite", "TS-456");

    assert.deepEqual(target, {
        targetType: "test-suite",
        targetId: "TS-456",
        testsuite: "TS-456",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(target, "testcycle"), false);
});

test("delivery rejects invalid or incomplete destination configuration", { concurrency: false }, () => {
    const delivery = loadFresh(deliveryPath);

    assert.throws(() => delivery.createTargetPayload("folder", "123"), /Unsupported targetType/);
    assert.throws(() => delivery.createTargetPayload("test-suite", ""), /targetId must be configured/);
    assert.doesNotThrow(() =>
        delivery.validateConfiguration({
            pulseUri: "https://pulse.example.test/parser",
            projectId: "5",
            targetType: "suite",
            targetId: "TS-456",
        })
    );
});

test("UFT fixture produces a Warning test log with deterministic timestamps", { concurrency: false }, async () => {
    const uft = loadFresh(uftPath);
    const logs = await uft.parseUftXml(uftFixture);

    assert.equal(logs.length, 1);
    assert.equal(logs[0].name, "UFT checkout flow");
    assert.equal(logs[0].status, "Warning");
    assert.equal(logs[0].exe_start_date, "2026-08-05T14:15:00.000Z");
    assert.equal(logs[0].exe_end_date, "2026-08-05T14:15:02.500Z");
    assert.equal(logs[0].test_step_logs.length, 1);
    assert.equal(logs[0].test_step_logs[0].order, 1);
    assert.equal(logs[0].test_step_logs[0].status, "Warning");
});

test("UFT destination selection requires exactly one Test Cycle or Test Suite", { concurrency: false }, () => {
    const uft = loadFresh(uftPath);

    assert.deepEqual(uft.getSubmissionDestination({ testcycle: "TC-1" }), {
        targetType: "test-cycle",
        targetId: "TC-1",
        payloadProperty: "testcycle",
    });
    assert.deepEqual(uft.getSubmissionDestination({ testsuite: "TS-1" }), {
        targetType: "test-suite",
        targetId: "TS-1",
        payloadProperty: "testsuite",
    });
    assert.throws(() => uft.getSubmissionDestination({}), { code: "TARGET_INVALID" });
    assert.throws(
        () => uft.getSubmissionDestination({ testcycle: "TC-1", testsuite: "TS-1" }),
        { code: "TARGET_INVALID" }
    );
});

test("UFT routes once to Test Suite and logs the downstream Pulse execution id", { concurrency: false }, async () => {
    const emitted = [];
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return [
                    { id: "pulse-child-uft-1", status: "QUEUED" },
                    { id: "pulse-child-uft-2", status: "QUEUED" },
                ];
            }
        },
    };

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const uft = loadFresh(uftPath);
        const output = await captureConsole(() =>
            uft.handler(
                {
                    event: {
                        deliverySchemaVersion: 2,
                        correlationId: "corr-uft-1",
                        projectId: "5",
                        testsuite: "TS-55",
                        resultFormat: "xml",
                        resultEncoding: "base64",
                        result: Buffer.from(uftFixture, "utf8").toString("base64"),
                    },
                    constants: {},
                    triggers: [{ name: "UpdateQTestWithResults" }],
                },
                {},
                () => {}
            )
        );

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].trigger.name, "UpdateQTestWithResults");
        assert.equal(emitted[0].payload.testsuite, "TS-55");
        assert.equal(emitted[0].payload.testcycle, undefined);
        assert.equal(emitted[0].payload.targetType, "test-suite");
        assert.equal(emitted[0].payload.targetId, "TS-55");
        assert.equal(emitted[0].payload.correlationId, "corr-uft-1");
        assert.equal(output.result.logs.length, 1);
        assert.match(output.lines.join("\n"), /childExecutionId="pulse-child-uft-1"/);
        assert.match(output.lines.join("\n"), /childExecutionId="pulse-child-uft-2"/);
        assert.match(output.lines.join("\n"), /correlationId="corr-uft-1"/);
    });
});

test("UFT fails explicitly when its required destination trigger is missing", { concurrency: false }, async () => {
    const uft = loadFresh(uftPath);
    const output = await captureConsole(async () => {
        await assert.rejects(
            uft.handler(
                {
                    event: {
                        correlationId: "corr-uft-missing-trigger",
                        projectId: "5",
                        testsuite: "TS-55",
                        result: Buffer.from(uftFixture, "utf8").toString("base64"),
                    },
                    constants: {},
                    triggers: [],
                },
                {},
                () => {}
            ),
            { code: "TRIGGER_NOT_FOUND" }
        );
    });

    assert.match(output.lines.join("\n"), /errorCode="TRIGGER_NOT_FOUND"/);
    assert.match(output.lines.join("\n"), /event="UpdateQTestWithResults"/);
});

test("UFT classifies a downstream Pulse 502 as unknown and disables automatic retry", { concurrency: false }, async () => {
    let invocationCount = 0;
    const pulseSdk = {
        Webhooks: class {
            async invoke() {
                invocationCount += 1;
                throw new Error("502 - Bad Gateway - resBody: undefined");
            }
        },
    };

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const uft = loadFresh(uftPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                uft.handler(
                    {
                        event: {
                            deliverySchemaVersion: 2,
                            correlationId: "corr-uft-502",
                            projectId: "5",
                            testsuite: "TS-55",
                            result: Buffer.from(uftFixture, "utf8").toString("base64"),
                        },
                        constants: {},
                        triggers: [{ name: "UpdateQTestWithResults" }],
                    },
                    {},
                    () => {}
                ),
                { code: "CHILD_EXECUTION_STATUS_UNKNOWN" }
            );
        });

        const logs = output.lines.join("\n");
        assert.equal(invocationCount, 1);
        assert.match(logs, /correlationId="corr-uft-502"/);
        assert.match(logs, /httpStatus="502"/);
        assert.match(logs, /invocationOutcome="unknown"/);
        assert.match(logs, /automaticRetry="disabled"/);
        assert.match(logs, /reconciliationRequired="true"/);
        assert.match(logs, /emittedPayloadBytes="\d+"/);
        assert.doesNotMatch(logs, /stage="complete"/);
    });
});

test("UFT treats missing required child execution metadata as an unknown outcome", { concurrency: false }, async () => {
    const pulseSdk = {
        Webhooks: class {
            async invoke() {
                return undefined;
            }
        },
    };

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const uft = loadFresh(uftPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                uft.handler(
                    {
                        event: {
                            correlationId: "corr-uft-no-metadata",
                            projectId: "5",
                            testsuite: "TS-55",
                            result: Buffer.from(uftFixture, "utf8").toString("base64"),
                        },
                        constants: {},
                        triggers: [{ name: "UpdateQTestWithResults" }],
                    },
                    {},
                    () => {}
                ),
                { code: "CHILD_EXECUTION_STATUS_UNKNOWN" }
            );
        });

        const logs = output.lines.join("\n");
        assert.match(logs, /returned no execution metadata/);
        assert.match(logs, /automaticRetry="disabled"/);
        assert.match(logs, /reconciliationRequired="true"/);
    });
});

test("delivery reports Pulse acceptance rather than completed downstream processing", { concurrency: false }, () => {
    const source = readFileSync(deliveryPath, "utf8");
    assert.match(source, /Pulse accepted the delivery; parser and downstream qTest processing continue asynchronously/);
    assert.doesNotMatch(source, /uploaded results successfully/);
});

test("Cypress JSON canary forwards a Test Suite only to the unified submission rule", { concurrency: false }, async () => {
    const emitted = [];
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return [{ id: "pulse-child-cypress", status: "QUEUED" }];
            }
        },
    };
    const result = {
        results: [
            {
                suites: [
                    {
                        title: "Checkout",
                        tests: [
                            {
                                state: "passed",
                                title: "submits an order",
                                uuid: "cypress-test-1",
                                code: "it('submits an order')",
                            },
                        ],
                    },
                ],
            },
        ],
        stats: {
            start: "2026-08-05T14:00:00.000Z",
            end: "2026-08-05T14:00:01.000Z",
        },
    };

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const cypress = loadFresh(cypressPath);
        const output = await captureConsole(() =>
            cypress.handler(
                {
                    event: {
                        deliverySchemaVersion: 2,
                        correlationId: "corr-cypress-suite",
                        projectId: "5",
                        targetType: "test-suite",
                        targetId: "TS-88",
                        testsuite: "TS-88",
                        resultFormat: "json",
                        resultEncoding: "identity",
                        result: result,
                    },
                    constants: {},
                    triggers: [{ name: "UpdateQTestWithResults" }],
                },
                {},
                () => {}
            )
        );

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].trigger.name, "UpdateQTestWithResults");
        assert.equal(emitted[0].payload.targetType, "test-suite");
        assert.equal(emitted[0].payload.targetId, "TS-88");
        assert.equal(emitted[0].payload.testsuite, "TS-88");
        assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload, "testcycle"), false);
        assert.equal(emitted[0].payload.logs.length, 1);
        assert.equal(output.result.correlationId, "corr-cypress-suite");
        assert.match(output.lines.join("\n"), /childExecutionId="pulse-child-cypress"/);
    });
});

test("Phase 4 JSON parser awaits a required Test Cycle submission and logs every child execution", { concurrency: false }, async () => {
    const emitted = [];
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                await new Promise((resolve) => setImmediate(resolve));
                emitted.push({ trigger: trigger, payload: payload });
                return [
                    { id: "pulse-postman-one", status: "QUEUED" },
                    { id: "pulse-postman-two", status: "QUEUED" },
                ];
            }
        },
    };
    const result = {
        collection: { info: { name: "Checkout API" } },
        run: {
            executions: [
                {
                    item: { name: "creates an order" },
                    assertions: [{ assertion: "status is 201" }],
                },
            ],
        },
    };

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const postman = loadMarketplaceParser(postmanPath);
        const output = await captureConsole(() =>
            postman.handler(
                {
                    event: {
                        deliverySchemaVersion: 2,
                        correlationId: "corr-postman-cycle",
                        projectId: "5",
                        targetType: "test-cycle",
                        targetId: "TC-42",
                        testcycle: "TC-42",
                        resultFormat: "json",
                        resultEncoding: "identity",
                        result: result,
                    },
                    triggers: [{ name: "UpdateQTestWithResults" }],
                },
                {},
                () => {}
            )
        );

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].trigger.name, "UpdateQTestWithResults");
        assert.equal(emitted[0].payload.targetType, "test-cycle");
        assert.equal(emitted[0].payload.testcycle, "TC-42");
        assert.equal(emitted[0].payload.logs.length, 1);
        assert.equal(output.result.correlationId, "corr-postman-cycle");
        assert.match(output.lines.join("\n"), /childExecutionId="pulse-postman-one"/);
        assert.match(output.lines.join("\n"), /childExecutionId="pulse-postman-two"/);
    });
});

test("Phase 4 XML parser finishes parsing before its required Test Suite submission", { concurrency: false }, async () => {
    const emitted = [];
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return { data: [{ id: "pulse-junit-suite", status: "QUEUED" }] };
            }
        },
    };
    const junitXml = [
        '<testsuite name="checkout" timestamp="2026-08-05T15:00:00.000Z">',
        '  <testcase name="Checkout: creates an order" time="1.25" />',
        "</testsuite>",
    ].join("\n");

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const junit = loadMarketplaceParser(junitPath);
        const output = await captureConsole(() =>
            junit.handler(
                {
                    event: {
                        deliverySchemaVersion: 2,
                        correlationId: "corr-junit-suite",
                        projectId: "5",
                        targetType: "test-suite",
                        targetId: "TS-42",
                        testsuite: "TS-42",
                        result: Buffer.from(junitXml).toString("base64"),
                    },
                    triggers: [{ name: "UpdateQTestWithResults" }],
                },
                {},
                () => {}
            )
        );

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].payload.targetType, "test-suite");
        assert.equal(emitted[0].payload.testsuite, "TS-42");
        assert.equal(emitted[0].payload.logs.length, 1);
        assert.equal(emitted[0].payload.logs[0].name, " creates an order");
        assert.equal(output.result.logs.length, 1);
        assert.match(output.lines.join("\n"), /childExecutionId="pulse-junit-suite"/);
    });
});

function createSonarWebhook() {
    return {
        taskId: "sonar-task-1",
        analysedAt: "2026-08-05T15:00:00.000Z",
        project: { key: "checkout", name: "Checkout Service" },
        qualityGate: {
            status: "ERROR",
            conditions: [
                {
                    metric: "coverage",
                    operator: "LESS_THAN",
                    errorThreshold: "80",
                    value: "72.5",
                    status: "ERROR",
                },
            ],
        },
    };
}

test("SonarQube raw webhook uses configured Test Suite destination", { concurrency: false }, async () => {
    const emitted = [];
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return [{ id: "pulse-child-sonar-suite", status: "QUEUED" }];
            }
        },
    };

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const sonar = loadFresh(sonarPath);
        const output = await captureConsole(() =>
            sonar.handler(
                {
                    event: createSonarWebhook(),
                    constants: {
                        QTEST_PROJECT_ID: "5",
                        QTEST_TARGET_TYPE: "test-suite",
                        QTEST_TARGET_ID: "TS-99",
                    },
                    triggers: [{ name: "UpdateQTestWithResults" }],
                },
                {},
                () => {}
            )
        );

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].trigger.name, "UpdateQTestWithResults");
        assert.equal(emitted[0].payload.projectId, "5");
        assert.equal(emitted[0].payload.targetType, "test-suite");
        assert.equal(emitted[0].payload.targetId, "TS-99");
        assert.equal(emitted[0].payload.testsuite, "TS-99");
        assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload, "testcycle"), false);
        assert.equal(emitted[0].payload.logs[0].status, "FAIL");
        assert.match(output.lines.join("\n"), /childExecutionId="pulse-child-sonar-suite"/);
    });
});

test("SonarQube raw webhook uses configured Test Cycle destination", { concurrency: false }, async () => {
    const emitted = [];
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return { data: [{ id: "pulse-child-sonar-cycle", status: "QUEUED" }] };
            }
        },
    };

    await withModuleMocks({ "@qasymphony/pulse-sdk": pulseSdk }, async () => {
        const sonar = loadFresh(sonarPath);
        const output = await sonar.handler(
            {
                event: createSonarWebhook(),
                constants: {
                    QTEST_PROJECT_ID: "5",
                    QTEST_TARGET_TYPE: "test-cycle",
                    QTEST_TARGET_ID: "TC-99",
                },
                triggers: [{ name: "UpdateQTestWithResults" }],
            },
            {},
            () => {}
        );

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].payload.targetType, "test-cycle");
        assert.equal(emitted[0].payload.targetId, "TC-99");
        assert.equal(emitted[0].payload.testcycle, "TC-99");
        assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload, "testsuite"), false);
        assert.equal(output.targetType, "test-cycle");
    });
});

test("SonarQube rejects webhooks with no quality gate conditions", { concurrency: false }, async () => {
    const webhook = createSonarWebhook();
    webhook.qualityGate.conditions = [];

    await withModuleMocks({ "@qasymphony/pulse-sdk": { Webhooks: class {} } }, async () => {
        const sonar = loadFresh(sonarPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                sonar.handler(
                    {
                        event: webhook,
                        constants: {
                            QTEST_PROJECT_ID: "5",
                            QTEST_TARGET_TYPE: "test-suite",
                            QTEST_TARGET_ID: "TS-99",
                        },
                        triggers: [{ name: "UpdateQTestWithResults" }],
                    },
                    {},
                    () => {}
                ),
                (error) => error && error.code === "NO_RESULTS"
            );
        });

        assert.match(output.lines.join("\n"), /errorCode="NO_RESULTS"/);
    });
});

test("Pulse execution normalization supports direct and response.data arrays", { concurrency: false }, () => {
    const uft = loadFresh(uftPath);
    const records = [{ id: "one" }, { id: "two" }];

    assert.deepEqual(uft.normalizePulseExecutions(records), records);
    assert.deepEqual(uft.normalizePulseExecutions({ data: records }), records);
    assert.deepEqual(uft.normalizePulseExecutions({ data: {} }), []);
});

test("every parser invokes only the unified submission rule and forwards destination metadata", { concurrency: false }, () => {
    const parserDirectory = path.join(repositoryRoot, "parsers");
    const parserFiles = readdirSync(parserDirectory)
        .filter((name) => name.endsWith(".js"))
        .sort();

    assert.equal(parserFiles.length, 15);

    parserFiles.forEach((parserFile) => {
        const source = readFileSync(path.join(parserDirectory, parserFile), "utf8");
        assert.match(
            source,
            /emitEvent\(\s*["']UpdateQTestWithResults["']/,
            `${parserFile} must invoke UpdateQTestWithResults`
        );
        assert.doesNotMatch(
            source,
            /UpdateQTestWithFormattedResults(?:Event)?/,
            `${parserFile} contains an obsolete submission trigger`
        );
        ["targetType", "targetId", "testcycle", "testsuite"].forEach((field) => {
            assert.match(source, new RegExp(`\\b${field}\\b`), `${parserFile} must forward ${field}`);
        });
        assert.match(source, /exports\.handler\s*=\s*async function/, `${parserFile} must expose an async handler`);
        assert.match(source, /function normalizePulseExecutions\(/, `${parserFile} must normalize Pulse responses`);
        assert.match(source, /\bchildExecutionId\b/, `${parserFile} must log child Pulse execution ids`);
        assert.match(
            source,
            /CHILD_EXECUTION_STATUS_UNKNOWN/,
            `${parserFile} must classify ambiguous downstream outcomes`
        );
        assert.match(source, /automaticRetry = "disabled"/, `${parserFile} must disable automatic retries`);
        assert.match(source, /reconciliationRequired/, `${parserFile} must log when reconciliation is required`);
        assert.match(source, /emittedPayloadBytes/, `${parserFile} must log the downstream payload size`);
        assert.equal(
            (source.match(/new Webhooks\(\)\.invoke/g) || []).length,
            1,
            `${parserFile} must invoke the Pulse SDK from exactly one path`
        );
        assert.match(
            source,
            /await emitEvent\(\s*["']UpdateQTestWithResults["'][\s\S]{0,100}required:\s*true/,
            `${parserFile} must await the required unified submission trigger`
        );

        source.split(/\r?\n/).forEach((line, index) => {
            if (!line.includes("emitEvent(") || /(?:async\s+)?function emitEvent\(/.test(line)) return;
            assert.match(line, /\bawait\s+emitEvent\(/, `${parserFile}:${index + 1} contains an unawaited event call`);
        });
    });
});

test("unified submission resolves canonical and legacy destinations without ambiguity", { concurrency: false }, async () => {
    await withModuleMocks(
        { axios: async () => {}, "@qasymphony/pulse-sdk": { Webhooks: class {} } },
        async () => {
            const action = loadFresh(submissionPath);

            assert.deepEqual(action.resolveDestination({ targetType: "test-suite", targetId: 123 }), {
                targetType: "test-suite",
                targetId: "123",
                apiVersion: "v3.1",
            });
            assert.deepEqual(action.resolveDestination({ testcycle: "TC-9" }), {
                targetType: "test-cycle",
                targetId: "TC-9",
                apiVersion: "v3",
            });
            assert.deepEqual(
                action.resolveDestination({
                    targetType: "test-suite",
                    targetId: "TS-9",
                    testsuite: "TS-9",
                }),
                { targetType: "test-suite", targetId: "TS-9", apiVersion: "v3.1" }
            );

            assert.throws(
                () => action.resolveDestination({ targetType: "test-suite", targetId: "TS-9", testcycle: "TC-9" }),
                { code: "TARGET_INVALID" }
            );
            assert.throws(() => action.resolveDestination({ testcycle: "TC-9", testsuite: "TS-9" }), {
                code: "TARGET_INVALID",
            });
        }
    );
});

test("ManagerURL is hostname-only and both qTest rules construct HTTPS without a global URL dependency", { concurrency: false }, async () => {
    await withModuleMocks(
        { axios: async () => {}, "@qasymphony/pulse-sdk": { Webhooks: class {} } },
        async () => {
            const action = loadFresh(submissionPath);
            const queue = loadFresh(queuePath);
            const validHostname = "example.qtestnet.com";
            const originalUrl = global.URL;

            try {
                global.URL = undefined;
                assert.equal(action.normalizeManagerBaseUrl(validHostname), "https://example.qtestnet.com");
                assert.equal(queue.normalizeManagerBaseUrl(validHostname), "https://example.qtestnet.com");
            } finally {
                global.URL = originalUrl;
            }

            [
                "https://example.qtestnet.com",
                "http://example.qtestnet.com",
                "example.qtestnet.com/",
                "example.qtestnet.com/api",
                "example.qtestnet.com?tenant=test",
                "example.qtestnet.com#fragment",
                "example.qtestnet.com:443",
                "example..qtestnet.com",
                "-example.qtestnet.com",
            ].forEach((invalidValue) => {
                assert.throws(() => action.normalizeManagerBaseUrl(invalidValue), { code: "CONFIG_INVALID" });
                assert.throws(() => queue.normalizeManagerBaseUrl(invalidValue), { code: "CONFIG_INVALID" });
            });
        }
    );
});

test("unified Test Cycle submission uses v3 and preserves parser step order", { concurrency: false }, async () => {
    let axiosRequest;
    const axiosMock = async (request) => {
        axiosRequest = request;
        return { status: 202, data: { id: 321, state: "IN_WAITING", type: "AUTOMATION_TEST_LOG" } };
    };

    await withModuleMocks(
        {
            axios: axiosMock,
            "@qasymphony/pulse-sdk": { Webhooks: class { async invoke() { return []; } } },
        },
        async () => {
            const action = loadFresh(submissionPath);
            const inputLogs = [
                {
                    name: "Cycle result",
                    status: "passed",
                    test_step_logs: [{ order: 7, description: "existing parser order" }],
                },
            ];
            const output = await captureConsole(() =>
                action.handler(
                    {
                        event: {
                            correlationId: "corr-cycle-1",
                            projectId: "5",
                            testcycle: "TC-77",
                            logs: inputLogs,
                        },
                        constants: { ManagerURL: "example.qtestnet.com", QTEST_TOKEN: "not-logged" },
                        triggers: [],
                    },
                    {},
                    () => {}
                )
            );

            assert.match(axiosRequest.url, /^https:\/\/example\.qtestnet\.com\/api\/v3\/projects\/5\/auto-test-logs/);
            assert.doesNotMatch(axiosRequest.url, /v3\.1/);
            assert.equal(axiosRequest.data.test_cycle, "TC-77");
            assert.equal(Object.prototype.hasOwnProperty.call(axiosRequest.data, "test_suite"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(axiosRequest.data, "execution_date"), false);
            assert.equal(axiosRequest.data.test_logs[0].test_step_logs[0].order, 7);
            assert.equal(inputLogs[0].test_step_logs[0].order, 7);
            assert.equal(output.result.targetType, "test-cycle");
            assert.equal(output.result.targetId, "TC-77");
            assert.equal(output.result.queueId, 321);
        }
    );
});

test("unified Test Suite submission copies steps, uses v3.1, and propagates queue correlation", { concurrency: false }, async () => {
    let axiosRequest;
    const emitted = [];
    const axiosMock = async (request) => {
        axiosRequest = request;
        return { status: 202, data: { id: 456, state: "IN_WAITING" } };
    };
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return { data: [{ id: `pulse-${trigger.name}`, status: "QUEUED" }] };
            }
        },
    };
    const inputLogs = [
        {
            name: "Later",
            status: "passed",
            exe_start_date: "2026-08-05T12:00:00.000Z",
            automation_content: "later",
            module_names: ["UFT"],
            test_step_logs: [{ order: 99, description: "step" }],
        },
        {
            name: "Earlier",
            status: "failed",
            exe_start_date: "2026-08-04T12:00:00.000Z",
            automation_content: "earlier",
            module_names: ["UFT"],
        },
    ];

    await withModuleMocks(
        { axios: axiosMock, "@qasymphony/pulse-sdk": pulseSdk },
        async () => {
            const action = loadFresh(submissionPath);
            const output = await captureConsole(() =>
                action.handler(
                    {
                        event: {
                            deliverySchemaVersion: 2,
                            correlationId: "corr-suite-1",
                            projectId: "5",
                            targetType: "test-suite",
                            targetId: "TS-55",
                            testsuite: "TS-55",
                            logs: inputLogs,
                        },
                        constants: {
                            ManagerURL: "example.qtestnet.com",
                            QTEST_TOKEN: "not-logged",
                            QTEST_QUEUE_POLL_DELAY_MS: 0,
                        },
                        triggers: [{ name: "ChatOpsEvent" }, { name: "CheckProcessingQueue" }],
                    },
                    {},
                    () => {}
                )
            );

            assert.equal(axiosRequest.timeout, 120000);
            assert.match(axiosRequest.url, /\/api\/v3\.1\/projects\/5\/test-runs\/0\/auto-test-logs/);
            assert.equal(axiosRequest.data.execution_date, "2026-08-04");
            assert.equal(axiosRequest.data.test_suite, "TS-55");
            assert.equal(Object.prototype.hasOwnProperty.call(axiosRequest.data, "test_cycle"), false);
            assert.equal(axiosRequest.data.test_logs[0].test_step_logs[0].order, 0);
            assert.equal(inputLogs[0].test_step_logs[0].order, 99);
            assert.deepEqual(axiosRequest.data.test_logs[0].module_names, ["UFT"]);

            const queueEvent = emitted.find((item) => item.trigger.name === "CheckProcessingQueue");
            assert.ok(queueEvent);
            assert.equal(queueEvent.payload.correlationId, "corr-suite-1");
            assert.equal(queueEvent.payload.queueId, 456);
            assert.equal(queueEvent.payload.attempt, 1);
            assert.equal(output.result.correlationId, "corr-suite-1");
            assert.equal(output.result.queueId, 456);
            assert.equal(output.result.targetType, "test-suite");
            assert.equal(output.result.targetId, "TS-55");
            assert.match(output.lines.join("\n"), /qTestQueueId="456"/);
            assert.match(output.lines.join("\n"), /childExecutionId="pulse-CheckProcessingQueue"/);
        }
    );
});

test("unified submission error fields redact bearer credentials", { concurrency: false }, async () => {
    await withModuleMocks(
        { axios: async () => {}, "@qasymphony/pulse-sdk": { Webhooks: class {} } },
        async () => {
            const action = loadFresh(submissionPath);
            const fields = action.getSafeErrorFields({
                message: "request failed with Bearer secret-token",
                response: { status: 401, data: { message: "token=private-value" } },
            });

            assert.equal(fields.httpStatus, 401);
            assert.doesNotMatch(fields.errorMessage, /secret-token/);
            assert.doesNotMatch(fields.responseSummary, /private-value/);
            assert.match(fields.errorMessage, /\[REDACTED\]/);
        }
    );
});

test("unified submission logs and rethrows qTest HTTP failures", { concurrency: false }, async () => {
    const axiosMock = async () => {
        const error = new Error("request failed with Bearer super-secret-token");
        error.response = { status: 503, data: { message: "token=private-response-token" } };
        throw error;
    };

    await withModuleMocks(
        {
            axios: axiosMock,
            "@qasymphony/pulse-sdk": { Webhooks: class { async invoke() { return []; } } },
        },
        async () => {
            const action = loadFresh(submissionPath);
            const output = await captureConsole(async () => {
                await assert.rejects(
                    action.handler(
                        {
                            event: {
                                correlationId: "corr-submit-failure",
                                projectId: "5",
                                targetType: "test-cycle",
                                targetId: "TC-77",
                                logs: [{ name: "Failed submission", status: "failed" }],
                            },
                            constants: { ManagerURL: "example.qtestnet.com", QTEST_TOKEN: "not-logged" },
                            triggers: [],
                        },
                        {},
                        () => {}
                    ),
                    { code: "QTEST_SUBMISSION_FAILED" }
                );
            });

            const renderedLogs = output.lines.join("\n");
            assert.match(renderedLogs, /errorCode="QTEST_SUBMISSION_FAILED"/);
            assert.match(renderedLogs, /httpStatus="503"/);
            assert.doesNotMatch(renderedLogs, /super-secret-token|private-response-token/);
        }
    );
});

test("Queue monitor returns on SUCCESS and preserves correlation", { concurrency: false }, async () => {
    const emitted = [];
    const axiosMock = async () => ({ status: 200, data: { state: "SUCCESS" } });
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return [{ id: "pulse-chatops", status: "QUEUED" }];
            }
        },
    };

    await withModuleMocks(
        { axios: axiosMock, "@qasymphony/pulse-sdk": pulseSdk },
        async () => {
            const queue = loadFresh(queuePath);
            const output = await captureConsole(() =>
                queue.handler(
                    {
                        event: {
                            correlationId: "corr-queue-success",
                            queueId: 456,
                            attempt: 2,
                            maxAttempts: 5,
                            pollDelayMs: 0,
                            timeoutMs: 60000,
                            startedAt: new Date().toISOString(),
                        },
                        constants: { ManagerURL: "example.qtestnet.com", QTEST_TOKEN: "not-logged" },
                        triggers: [{ name: "ChatOpsEvent" }],
                    },
                    {},
                    () => {}
                )
            );

            assert.equal(output.result.state, "SUCCESS");
            assert.equal(output.result.correlationId, "corr-queue-success");
            assert.equal(emitted.length, 1);
            assert.equal(emitted[0].trigger.name, "ChatOpsEvent");
            assert.match(output.lines.join("\n"), /childExecutionId="pulse-chatops"/);
        }
    );
});

test("Queue monitor schedules one bounded child check for PENDING", { concurrency: false }, async () => {
    const emitted = [];
    const axiosMock = async () => ({ status: 200, data: { state: "PENDING" } });
    const pulseSdk = {
        Webhooks: class {
            async invoke(trigger, payload) {
                emitted.push({ trigger: trigger, payload: payload });
                return { data: [{ id: "pulse-next-queue", status: "QUEUED" }] };
            }
        },
    };

    await withModuleMocks(
        { axios: axiosMock, "@qasymphony/pulse-sdk": pulseSdk },
        async () => {
            const queue = loadFresh(queuePath);
            const result = await queue.handler(
                {
                    event: {
                        correlationId: "corr-queue-pending",
                        queueId: 456,
                        attempt: 1,
                        maxAttempts: 3,
                        pollDelayMs: 0,
                        timeoutMs: 60000,
                        startedAt: new Date().toISOString(),
                    },
                    constants: { ManagerURL: "example.qtestnet.com", QTEST_TOKEN: "not-logged" },
                    triggers: [{ name: "CheckProcessingQueue" }],
                },
                {},
                () => {}
            );

            assert.equal(result.state, "PENDING");
            assert.equal(result.nextAttempt, 2);
            assert.equal(emitted.length, 1);
            assert.equal(emitted[0].payload.attempt, 2);
            assert.equal(emitted[0].payload.maxAttempts, 3);
            assert.equal(result.childExecutions[0].id, "pulse-next-queue");
        }
    );
});

test("Queue monitor classifies a Pulse 502 as unknown without retrying the child call", { concurrency: false }, async () => {
    let invocationCount = 0;
    const axiosMock = async () => ({ status: 200, data: { state: "PENDING" } });
    const pulseSdk = {
        Webhooks: class {
            async invoke() {
                invocationCount += 1;
                throw new Error("502 - Bad Gateway - resBody: undefined");
            }
        },
    };

    await withModuleMocks(
        { axios: axiosMock, "@qasymphony/pulse-sdk": pulseSdk },
        async () => {
            const queue = loadFresh(queuePath);
            const output = await captureConsole(async () => {
                await assert.rejects(
                    queue.handler(
                        {
                            event: {
                                correlationId: "corr-queue-502",
                                queueId: 456,
                                attempt: 1,
                                maxAttempts: 3,
                                pollDelayMs: 0,
                                timeoutMs: 60000,
                                startedAt: new Date().toISOString(),
                            },
                            constants: { ManagerURL: "example.qtestnet.com", QTEST_TOKEN: "not-logged" },
                            triggers: [{ name: "CheckProcessingQueue" }],
                        },
                        {},
                        () => {}
                    ),
                    { code: "CHILD_EXECUTION_STATUS_UNKNOWN" }
                );
            });

            const logs = output.lines.join("\n");
            assert.equal(invocationCount, 1);
            assert.match(logs, /correlationId="corr-queue-502"/);
            assert.match(logs, /httpStatus="502"/);
            assert.match(logs, /invocationOutcome="unknown"/);
            assert.match(logs, /automaticRetry="disabled"/);
            assert.match(logs, /reconciliationRequired="true"/);
            assert.match(logs, /emittedPayloadBytes="\d+"/);
        }
    );
});

test("Queue monitor fails explicitly when the attempt budget is exhausted", { concurrency: false }, async () => {
    const axiosMock = async () => ({ status: 200, data: { state: "PENDING" } });

    await withModuleMocks(
        {
            axios: axiosMock,
            "@qasymphony/pulse-sdk": { Webhooks: class { async invoke() { return []; } } },
        },
        async () => {
            const queue = loadFresh(queuePath);
            const output = await captureConsole(async () => {
                await assert.rejects(
                    queue.handler(
                        {
                            event: {
                                correlationId: "corr-queue-timeout",
                                queueId: 456,
                                attempt: 1,
                                maxAttempts: 1,
                                pollDelayMs: 0,
                                timeoutMs: 60000,
                                startedAt: new Date().toISOString(),
                            },
                            constants: { ManagerURL: "example.qtestnet.com", QTEST_TOKEN: "not-logged" },
                            triggers: [],
                        },
                        {},
                        () => {}
                    ),
                    { code: "QTEST_QUEUE_TIMEOUT" }
                );
            });

            assert.match(output.lines.join("\n"), /errorCode="QTEST_QUEUE_TIMEOUT"/);
        }
    );
});
