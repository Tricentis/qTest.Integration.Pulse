const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const slackPath = path.join(repositoryRoot, "chatops", "SlackMessage.js");
const teamsPath = path.join(repositoryRoot, "chatops", "MSTeamsPowerAutomate.js");
const retiredAttachmentPath = path.join(repositoryRoot, "chatops", "SlackAttachment.js");

function loadFresh(modulePath) {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
}

async function withModuleMocks(mocks, callback) {
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return await callback();
    } finally {
        Module._load = originalLoad;
    }
}

function createAxiosHarness(options) {
    const settings = Object.assign({ status: 200, responseBody: "ok" }, options || {});
    const state = { requestCount: 0 };

    const axios = {
        async post(url, data, requestOptions) {
            state.requestCount += 1;
            state.url = url;
            state.data = data;
            state.options = requestOptions;
            if (settings.error) throw settings.error;
            return { status: settings.status, data: settings.responseBody };
        },
    };

    return { axios: axios, state: state };
}

async function captureConsole(callback) {
    const original = { log: console.log, warn: console.warn, error: console.error };
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

test("Slack ChatOps posts the neutral message contract with Axios", { concurrency: false }, async () => {
    const harness = createAxiosHarness();
    await withModuleMocks({ axios: harness.axios }, async () => {
        const slack = loadFresh(slackPath);
        const output = await captureConsole(() =>
            slack.handler(
                {
                    event: { correlationId: "corr-slack-1", message: "qTest queue completed" },
                    constants: {
                        SlackWorkflowWebhook: "https://hooks.slack.com/triggers/T000/B000/secret-value",
                    },
                    triggers: [],
                },
                {},
                () => {}
            )
        );

        assert.equal(harness.state.url, "https://hooks.slack.com/triggers/T000/B000/secret-value");
        assert.equal(harness.state.options.headers["Content-Type"], "application/json");
        assert.deepEqual(harness.state.data, { message: "qTest queue completed" });
        assert.equal(harness.state.options.timeout, 15000);
        assert.equal(harness.state.options.validateStatus(500), true);
        assert.equal(output.result.correlationId, "corr-slack-1");
        assert.equal(output.result.httpStatus, 200);
        assert.equal(output.result.truncated, false);
        assert.match(output.lines.join("\n"), /deliveryMode="workflow-webhook"/);
        assert.match(output.lines.join("\n"), /message="Slack Workflow Builder accepted the ChatOps message\."/);
        assert.doesNotMatch(output.lines.join("\n"), /secret-value/);
    });
});

test("Slack ChatOps truncates oversized messages without invoking a file API", { concurrency: false }, async () => {
    const harness = createAxiosHarness({ status: 202, responseBody: "accepted" });
    await withModuleMocks({ axios: harness.axios }, async () => {
        const slack = loadFresh(slackPath);
        const output = await captureConsole(() =>
            slack.handler(
                {
                    event: { message: "x".repeat(100) },
                    constants: {
                        SlackWorkflowWebhook: "https://hooks.slack.com/triggers/T000/B000/another-secret",
                        SLACK_MESSAGE_MAX_CHARACTERS: 40,
                    },
                    triggers: [],
                },
                {},
                () => {}
            )
        );

        const postedMessage = harness.state.data.message;
        assert.equal(postedMessage.length, 40);
        assert.match(postedMessage, /\[truncated by qTest Pulse\]$/);
        assert.equal(output.result.truncated, true);
        assert.match(output.lines.join("\n"), /truncated="true"/);
    });
});

test("Slack URL validation does not depend on the global URL constructor", { concurrency: false }, () => {
    const originalUrl = global.URL;
    global.URL = undefined;
    try {
        const slack = loadFresh(slackPath);
        assert.equal(
            slack.normalizeWorkflowUrl("https://hooks.slack.com/triggers/T000/B000/secret"),
            "https://hooks.slack.com/triggers/T000/B000/secret"
        );
    } finally {
        global.URL = originalUrl;
    }
});

test("Slack ChatOps rejects legacy Incoming Webhook URLs before making a request", { concurrency: false }, async () => {
    const harness = createAxiosHarness();
    await withModuleMocks({ axios: harness.axios }, async () => {
        const slack = loadFresh(slackPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                slack.handler(
                    {
                        event: { correlationId: "corr-slack-config", message: "test" },
                        constants: {
                            ChatOpsWebhook: "https://hooks.slack.com/services/T000/B000/legacy-secret",
                        },
                        triggers: [],
                    },
                    {},
                    () => {}
                ),
                { code: "CONFIG_INVALID" }
            );
        });

        assert.equal(harness.state.requestCount, 0);
        assert.match(output.lines.join("\n"), /errorCode="CONFIG_INVALID"/);
        assert.doesNotMatch(output.lines.join("\n"), /legacy-secret/);
    });
});

test("Slack ChatOps logs a sanitized Workflow Builder HTTP failure and rethrows it", { concurrency: false }, async () => {
    const harness = createAxiosHarness({
        status: 403,
        responseBody: "denied https://hooks.slack.com/triggers/T000/B000/response-secret",
    });
    await withModuleMocks({ axios: harness.axios }, async () => {
        const slack = loadFresh(slackPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                slack.handler(
                    {
                        event: { correlationId: "corr-slack-403", message: "test" },
                        constants: {
                            SlackWorkflowWebhook: "https://hooks.slack.com/triggers/T000/B000/request-secret",
                        },
                        triggers: [],
                    },
                    {},
                    () => {}
                ),
                { code: "SLACK_WORKFLOW_HTTP_ERROR" }
            );
        });

        const logs = output.lines.join("\n");
        assert.match(logs, /httpStatus="403"/);
        assert.match(logs, /responseSummary="denied \[REDACTED_SLACK_WEBHOOK\]"/);
        assert.doesNotMatch(logs, /request-secret|response-secret/);
    });
});

test("Slack ChatOps fails inside the Pulse container budget with explicit timeout context", { concurrency: false }, async () => {
    const timeoutError = Object.assign(new Error("timeout of 12000ms exceeded"), { code: "ECONNABORTED" });
    const harness = createAxiosHarness({ error: timeoutError });
    await withModuleMocks({ axios: harness.axios }, async () => {
        const slack = loadFresh(slackPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                slack.handler(
                    {
                        event: { correlationId: "corr-slack-timeout", message: "test" },
                        constants: {
                            SlackWorkflowWebhook: "https://hooks.slack.com/triggers/T000/B000/request-secret",
                            SLACK_REQUEST_TIMEOUT_MS: 12000,
                        },
                        triggers: [],
                    },
                    {},
                    () => {}
                ),
                { code: "SLACK_WORKFLOW_TIMEOUT" }
            );
        });

        const logs = output.lines.join("\n");
        assert.equal(harness.state.options.timeout, 12000);
        assert.match(logs, /requestTimeoutMs="12000"/);
        assert.match(logs, /errorCode="SLACK_WORKFLOW_TIMEOUT"/);
        assert.match(logs, /rootCauseCode="ECONNABORTED"/);
    });
});

test("Slack ChatOps surfaces a sanitized transport cause in the Pulse execution error", { concurrency: false }, async () => {
    const requestError = Object.assign(
        new Error("connect failed for https://hooks.slack.com/triggers/T000/B000/private-secret"),
        { code: "ECONNRESET" }
    );
    const harness = createAxiosHarness({ error: requestError });
    await withModuleMocks({ axios: harness.axios }, async () => {
        const slack = loadFresh(slackPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                slack.handler(
                    {
                        event: { correlationId: "corr-slack-network", message: "test" },
                        constants: {
                            SlackWorkflowWebhook: "https://hooks.slack.com/triggers/T000/B000/request-secret",
                        },
                        triggers: [],
                    },
                    {},
                    () => {}
                ),
                (error) => {
                    assert.equal(error.code, "SLACK_WORKFLOW_REQUEST_FAILED");
                    assert.match(error.message, /Cause: connect failed for \[REDACTED_SLACK_WEBHOOK\]/);
                    assert.doesNotMatch(error.message, /private-secret|request-secret/);
                    return true;
                }
            );
        });

        const logs = output.lines.join("\n");
        assert.match(logs, /rootCauseCode="ECONNRESET"/);
        assert.doesNotMatch(logs, /private-secret|request-secret/);
    });
});

test("Teams ChatOps posts the neutral message contract as an Adaptive Card", { concurrency: false }, async () => {
    const harness = createAxiosHarness({ status: 202, responseBody: { messageId: "teams-message-1" } });
    await withModuleMocks({ axios: harness.axios }, async () => {
        const teams = loadFresh(teamsPath);
        const output = await captureConsole(() =>
            teams.handler(
                {
                    event: { correlationId: "corr-teams-1", message: "qTest queue completed" },
                    constants: {
                        TeamsWebhook: "https://example.azure.com:443/workflows/workflow-id/triggers/manual/paths/invoke?sig=private-signature",
                    },
                    triggers: [],
                },
                {},
                () => {}
            )
        );

        assert.match(harness.state.url, /^https:\/\/example\.azure\.com/);
        assert.equal(harness.state.options.timeout, 15000);
        assert.equal(harness.state.options.headers["Content-Type"], "application/json");
        assert.equal(harness.state.options.validateStatus(500), true);
        assert.equal(harness.state.data.type, "message");
        assert.equal(harness.state.data.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
        assert.equal(harness.state.data.attachments[0].contentUrl, null);
        assert.equal(harness.state.data.attachments[0].content.body[0].text, "qTest queue completed");
        assert.equal(harness.state.data.attachments[0].content.body[0].wrap, true);
        assert.equal(output.result.correlationId, "corr-teams-1");
        assert.equal(output.result.provider, "microsoft-teams");
        assert.equal(output.result.httpStatus, 202);
        assert.match(output.lines.join("\n"), /message="Microsoft Teams Workflow accepted the ChatOps message\."/);
        assert.doesNotMatch(output.lines.join("\n"), /private-signature/);
    });
});

test("Teams accepts legacy and current Workflow callback URL shapes but requires HTTPS", { concurrency: false }, () => {
    const teams = loadFresh(teamsPath);
    const legacyUrl = "https://example.azure.com:443/workflows/workflow-id/triggers/manual/paths/invoke?sig=private";
    const currentUrl = "https://tenant.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/workflow-id/triggers/manual/paths/invoke?api-version=1&sig=private";

    assert.equal(teams.normalizeTeamsWebhookUrl(legacyUrl), legacyUrl);
    assert.equal(teams.normalizeTeamsWebhookUrl(currentUrl), currentUrl);
    assert.throws(
        () => teams.normalizeTeamsWebhookUrl("http://example.azure.com/workflows/id?sig=private"),
        { code: "CONFIG_INVALID" }
    );
});

test("Teams ChatOps truncates oversized messages and reports HTTP failures", { concurrency: false }, async () => {
    const harness = createAxiosHarness({
        status: 403,
        responseBody: "denied https://example.azure.com/workflows/private-id/triggers/manual/paths/invoke?sig=response-secret",
    });
    await withModuleMocks({ axios: harness.axios }, async () => {
        const teams = loadFresh(teamsPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                teams.handler(
                    {
                        event: { correlationId: "corr-teams-403", message: "x".repeat(100) },
                        constants: {
                            TeamsWebhook: "https://example.azure.com/workflows/request-id/triggers/manual/paths/invoke?sig=request-secret",
                            TEAMS_MESSAGE_MAX_CHARACTERS: 40,
                        },
                        triggers: [],
                    },
                    {},
                    () => {}
                ),
                { code: "TEAMS_WORKFLOW_HTTP_ERROR" }
            );
        });

        assert.equal(harness.state.data.attachments[0].content.body[0].text.length, 40);
        assert.match(harness.state.data.attachments[0].content.body[0].text, /\[truncated by qTest Pulse\]$/);
        const logs = output.lines.join("\n");
        assert.match(logs, /httpStatus="403"/);
        assert.match(logs, /responseSummary="denied \[REDACTED_TEAMS_WEBHOOK\]"/);
        assert.doesNotMatch(logs, /request-secret|response-secret|request-id|private-id/);
    });
});

test("Teams ChatOps surfaces sanitized timeout context and rethrows it", { concurrency: false }, async () => {
    const timeoutError = Object.assign(
        new Error("timeout calling https://example.azure.com/workflows/private-id/triggers/manual/paths/invoke?sig=private-secret"),
        { code: "ECONNABORTED" }
    );
    const harness = createAxiosHarness({ error: timeoutError });
    await withModuleMocks({ axios: harness.axios }, async () => {
        const teams = loadFresh(teamsPath);
        const output = await captureConsole(async () => {
            await assert.rejects(
                teams.handler(
                    {
                        event: { correlationId: "corr-teams-timeout", message: "test" },
                        constants: {
                            TeamsWebhook: "https://example.azure.com/workflows/request-id/triggers/manual/paths/invoke?sig=request-secret",
                            TEAMS_REQUEST_TIMEOUT_MS: 12000,
                        },
                        triggers: [],
                    },
                    {},
                    () => {}
                ),
                (error) => {
                    assert.equal(error.code, "TEAMS_WORKFLOW_TIMEOUT");
                    assert.match(error.message, /Cause: timeout calling \[REDACTED_TEAMS_WEBHOOK\]/);
                    assert.doesNotMatch(error.message, /private-secret|private-id|request-secret|request-id/);
                    return true;
                }
            );
        });

        assert.equal(harness.state.options.timeout, 12000);
        const logs = output.lines.join("\n");
        assert.match(logs, /rootCauseCode="ECONNABORTED"/);
        assert.match(logs, /requestTimeoutMs="12000"/);
        assert.doesNotMatch(logs, /private-secret|private-id|request-secret|request-id/);
    });
});

test("the deprecated Slack attachment Action is retired", { concurrency: false }, () => {
    const source = readFileSync(slackPath, "utf8");
    assert.equal(existsSync(retiredAttachmentPath), false);
    assert.doesNotMatch(source, /files\.upload|files\.getUploadURLExternal|\bfetch\(|AbortSignal|new URL|require\("https"\)/);
    assert.match(source, /require\("axios"\)/);
});
