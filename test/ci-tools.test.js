const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const ciRoot = path.join(repositoryRoot, "citools");

function loadFresh(fileName) {
    const modulePath = path.join(ciRoot, fileName);
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

function createPulseSdk(state, response) {
    return {
        Webhooks: class {
            async invoke(trigger, payload) {
                state.trigger = trigger;
                state.payload = payload;
                state.invocations = (state.invocations || 0) + 1;
                if (response instanceof Error) throw response;
                return response === undefined ? [{ id: "chatops-child-1", status: "QUEUED" }] : response;
            }
        }
    };
}

test("Bamboo uses Axios auth, preserves legacy host compatibility, and awaits correlated ChatOps", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const axios = {
        async post(url, data, options) {
            http.url = url;
            http.data = data;
            http.options = options;
            return {
                status: 200,
                data: { buildResultKey: "PLAN-42", link: { href: "https://bamboo.example/build/42" } },
            };
        },
    };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const bamboo = loadFresh("TriggerBamboo.js");
        const output = await captureConsole(() => bamboo.handler({
            event: { correlationId: "corr-bamboo" },
            constants: {
                BambooUserName: "build-user",
                BambooPassword: "private-password",
                BambooURL: "bamboo.example:8085",
                BambooProjectCode: "PLAN MAIN",
                CI_REQUEST_TIMEOUT_MS: 12000,
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "http://bamboo.example:8085/rest/api/latest/queue/PLAN%20MAIN");
        assert.deepEqual(http.options.auth, { username: "build-user", password: "private-password" });
        assert.equal(http.options.timeout, 12000);
        assert.equal(http.options.params.os_authType, "basic");
        assert.equal(output.result.runId, "PLAN-42");
        assert.equal(pulse.payload.correlationId, "corr-bamboo");
        assert.deepEqual(pulse.payload.source, {
            type: "ci-trigger",
            provider: "bamboo",
            pipeline: "PLAN MAIN",
            runId: "PLAN-42",
        });
        const logs = output.lines.join("\n");
        assert.match(logs, /insecureTransport="true"/);
        assert.match(logs, /childExecutionId="chatops-child-1"/);
        assert.doesNotMatch(logs, /private-password/);
    });
});

test("Jenkins keeps credentials out of URLs and uses the crumb's returned header", { concurrency: false }, async () => {
    const http = { calls: [] };
    const pulse = {};
    const axios = {
        async get(url, options) {
            http.calls.push({ method: "get", url: url, options: options });
            return { status: 200, data: "X-Custom-Crumb:crumb-value" };
        },
        async post(url, data, options) {
            http.calls.push({ method: "post", url: url, data: data, options: options });
            return { status: 201, data: "", headers: { location: "https://jenkins.example/queue/item/91/" } };
        },
    };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const jenkins = loadFresh("TriggerJenkins.js");
        const output = await captureConsole(() => jenkins.handler({
            event: { correlationId: "corr-jenkins" },
            constants: {
                JenkinsUserName: "jenkins-user",
                JenkinsAPIToken: "private-api-token",
                JenkinsURL: "https://jenkins.example/root",
                JenkinsJobName: "folder/release build",
                JenkinsJobToken: "private-job-token",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.calls[0].url, "https://jenkins.example/root/crumbIssuer/api/xml");
        assert.deepEqual(http.calls[0].options.auth, { username: "jenkins-user", password: "private-api-token" });
        assert.equal(http.calls[1].url, "https://jenkins.example/root/job/folder/job/release%20build/build");
        assert.equal(http.calls[1].options.headers["X-Custom-Crumb"], "crumb-value");
        assert.equal(http.calls[1].options.params.token, "private-job-token");
        assert.doesNotMatch(http.calls[1].url, /private-api-token|private-job-token|jenkins-user@/);
        assert.equal(output.result.runId, "91");
        assert.equal(output.result.dispatchMode, "standard");
        assert.equal(output.result.parameterCount, 0);
        assert.equal(pulse.payload.source.provider, "jenkins");
        assert.equal(pulse.payload.source.dispatchMode, "standard");
        assert.doesNotMatch(output.lines.join("\n"), /private-api-token|private-job-token|crumb-value/);
    });
});

test("parameterized Jenkins accepts general parameters and retains legacy tag mapping", { concurrency: false }, async () => {
    const http = {};
    const axios = {
        async get() { return { status: 200, data: "Jenkins-Crumb:crumb" }; },
        async post(url, data, options) {
            http.url = url;
            http.options = options;
            return { status: 201, headers: { location: "https://jenkins.example/queue/item/5/" } };
        },
    };

    await withModuleMocks({ axios: axios }, async () => {
        const jenkins = loadFresh("TriggerJenkins.js");
        const output = await captureConsole(() => jenkins.handler({
            event: {
                correlationId: "corr-jenkins-params",
                tag: "legacy tag & value",
                parameters: { Environment: "qa/prod", Retries: 2 },
            },
            constants: {
                JenkinsUserName: "jenkins-user",
                JenkinsAPIToken: "api-token",
                JenkinsURL: "https://jenkins.example",
                JenkinsParamJob: "parameterized",
                JenkinsJobToken: "job-token",
            },
            triggers: [],
        }, {}, () => {}));

        assert.match(http.url, /buildWithParameters$/);
        assert.deepEqual(http.options.params, {
            token: "job-token",
            Environment: "qa/prod",
            Retries: "2",
            Tag: "legacy tag & value",
        });
        assert.equal(output.result.parameterCount, 3);
        assert.equal(output.result.dispatchMode, "parameterized");
        assert.match(output.lines.join("\n"), /TRIGGER_NOT_FOUND/);
    });
});

test("the separate parameterized Jenkins Action is retired", { concurrency: false }, () => {
    assert.equal(existsSync(path.join(ciRoot, "TriggerJenkinsWithParams.js")), false);
});

test("TeamCity XML-escapes the build type and uses Axios authentication", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const axios = {
        async post(url, data, options) {
            http.url = url;
            http.data = data;
            http.options = options;
            return { status: 200, data: { id: 321, webUrl: "https://teamcity.example/build/321" } };
        },
    };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const teamCity = loadFresh("TriggerTeamCity.js");
        const output = await captureConsole(() => teamCity.handler({
            event: { correlationId: "corr-teamcity" },
            constants: {
                TeamCityUserName: "teamcity-user",
                TeamCityPassword: "private-password",
                TeamCityURL: "teamcity.example",
                TeamCityPort: 8111,
                TeamCityBuildCode: "build<&\"'>",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "http://teamcity.example:8111/httpAuth/app/rest/buildQueue");
        assert.equal(http.data, '<build><buildType id="build&lt;&amp;&quot;&apos;&gt;"/></build>');
        assert.deepEqual(http.options.auth, { username: "teamcity-user", password: "private-password" });
        assert.equal(http.options.headers.Accept, "application/json");
        assert.equal(output.result.runId, 321);
        assert.equal(pulse.payload.source.pipeline, "build<&\"'>");
        assert.doesNotMatch(output.lines.join("\n"), /private-password/);
    });
});

test("CI primary HTTP failures are logged safely, notified, and rethrown", { concurrency: false }, async () => {
    const pulse = {};
    const axios = {
        async post() {
            return {
                status: 500,
                data: "failed token=private-token password=private-password",
            };
        },
    };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const bamboo = loadFresh("TriggerBamboo.js");
        const output = await captureConsole(async () => {
            await assert.rejects(bamboo.handler({
                event: { correlationId: "corr-bamboo-fail" },
                constants: {
                    BambooUserName: "user",
                    BambooPassword: "private-password",
                    BambooURL: "https://bamboo.example",
                    BambooProjectCode: "PLAN",
                },
                triggers: [{ name: "ChatOpsEvent" }],
            }, {}, () => {}), { code: "BAMBOO_HTTP_ERROR" });
        });

        assert.match(pulse.payload.message, /BAMBOO_HTTP_ERROR/);
        assert.match(output.lines.join("\n"), /responseSummary="failed token=\[REDACTED\] password=\[REDACTED\]"/);
        assert.doesNotMatch(output.lines.join("\n"), /private-token|private-password/);
    });
});

test("CI response summaries redact secret-like JSON keys", { concurrency: false }, async () => {
    const axios = {
        async post() {
            return { status: 400, data: { message: "invalid input", SECRET_VALUE: "private-response-value" } };
        },
    };
    await withModuleMocks({ axios: axios }, async () => {
        const github = loadFresh("TriggerGitHubActions.js");
        const output = await captureConsole(async () => {
            await assert.rejects(github.handler({
                event: { ref: "main" },
                constants: {
                    GitHubOwner: "acme", GitHubRepository: "repo", GitHubWorkflow: "ci.yml", GitHubToken: "private-token",
                },
                triggers: [],
            }, {}, () => {}), { code: "GITHUB_ACTIONS_HTTP_ERROR" });
        });
        assert.match(output.lines.join("\n"), /SECRET_VALUE/);
        assert.match(output.lines.join("\n"), /\[REDACTED\]/);
        assert.doesNotMatch(output.lines.join("\n"), /private-response-value|private-token/);
    });
});

test("an ambiguous optional ChatOps failure does not mask a successful CI dispatch", { concurrency: false }, async () => {
    const axios = {
        async post() { return { status: 202, data: { buildResultKey: "PLAN-7" } }; },
    };
    const pulseError = Object.assign(new Error("502 - Bad Gateway"), { response: { status: 502 } });

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk({}, pulseError) }, async () => {
        const bamboo = loadFresh("TriggerBamboo.js");
        const output = await captureConsole(() => bamboo.handler({
            event: { correlationId: "corr-chatops-unknown" },
            constants: {
                BambooUserName: "user",
                BambooPassword: "password",
                BambooURL: "https://bamboo.example",
                BambooProjectCode: "PLAN",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(output.result.runId, "PLAN-7");
        assert.match(output.lines.join("\n"), /automaticRetry="disabled"/);
        assert.match(output.lines.join("\n"), /invocationOutcome="unknown"/);
    });
});

test("GitHub Actions dispatches a ref and inputs without exposing its token", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const axios = {
        async post(url, data, options) {
            http.url = url; http.data = data; http.options = options;
            return {
                status: 200,
                data: { workflow_run_id: 901, html_url: "https://github.com/acme/widgets/actions/runs/901" },
            };
        },
    };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const github = loadFresh("TriggerGitHubActions.js");
        const output = await captureConsole(() => github.handler({
            event: { correlationId: "corr-github", ref: "release/v1", inputs: { environment: "qa", deploy: true } },
            constants: {
                GitHubOwner: "acme",
                GitHubRepository: "widgets",
                GitHubWorkflow: "release workflow.yml",
                GitHubToken: "private-github-token",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "https://api.github.com/repos/acme/widgets/actions/workflows/release%20workflow.yml/dispatches");
        assert.deepEqual(http.data, { ref: "release/v1", inputs: { environment: "qa", deploy: true } });
        assert.equal(http.options.headers.Authorization, "Bearer private-github-token");
        assert.equal(http.options.headers["X-GitHub-Api-Version"], "2026-03-10");
        assert.equal(output.result.runId, 901);
        assert.equal(pulse.payload.source.provider, "github-actions");
        assert.doesNotMatch(output.lines.join("\n"), /private-github-token/);
    });
});

test("GitLab sends trigger authentication separately from variables and inputs", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const axios = {
        async post(url, data, options) {
            http.url = url; http.data = data; http.options = options;
            return { status: 201, data: { id: 77, web_url: "https://gitlab.example/acme/widgets/-/pipelines/77" } };
        },
    };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const gitlab = loadFresh("TriggerGitLabPipeline.js");
        const output = await captureConsole(() => gitlab.handler({
            event: {
                correlationId: "corr-gitlab",
                ref: "main",
                variables: { TARGET: "qa" },
                inputs: { scan_security: true },
            },
            constants: {
                GitLabURL: "https://gitlab.example",
                GitLabProjectId: "acme/widgets",
                GitLabTriggerToken: "private-gitlab-token",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "https://gitlab.example/api/v4/projects/acme%2Fwidgets/trigger/pipeline");
        assert.deepEqual(http.data, { variables: { TARGET: "qa" }, inputs: { scan_security: true } });
        assert.deepEqual(http.options.params, { token: "private-gitlab-token", ref: "main" });
        assert.equal(output.result.runId, 77);
        assert.equal(pulse.payload.source.provider, "gitlab-ci");
        assert.doesNotMatch(output.lines.join("\n"), /private-gitlab-token/);
    });
});

test("Azure Pipelines builds a v7.1 run payload without mutating event resources", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const resources = { repositories: { self: { version: "existing-version" } } };
    const axios = {
        async post(url, data, options) {
            http.url = url; http.data = data; http.options = options;
            return {
                status: 200,
                data: { id: 808, _links: { web: { href: "https://dev.azure.com/acme/project/_build/results?buildId=808" } } },
            };
        },
    };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const azure = loadFresh("TriggerAzurePipeline.js");
        const output = await captureConsole(() => azure.handler({
            event: {
                correlationId: "corr-azure",
                ref: "release/v2",
                variables: { Environment: "qa", SecretValue: { value: "hidden", isSecret: true } },
                templateParameters: { deploy: true },
                resources: resources,
                stagesToSkip: ["ManualApproval"],
            },
            constants: {
                AzureDevOpsOrganization: "acme org",
                AzureDevOpsProject: "quality project",
                AzureDevOpsPipelineId: 42,
                AZDO_TOKEN: "private-azure-token",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "https://dev.azure.com/acme%20org/quality%20project/_apis/pipelines/42/runs?api-version=7.1");
        assert.deepEqual(http.options.auth, { username: "", password: "private-azure-token" });
        assert.equal(http.data.resources.repositories.self.refName, "refs/heads/release/v2");
        assert.equal(http.data.resources.repositories.self.version, "existing-version");
        assert.deepEqual(resources, { repositories: { self: { version: "existing-version" } } });
        assert.deepEqual(http.data.variables.Environment, { value: "qa" });
        assert.deepEqual(http.data.variables.SecretValue, { value: "hidden", isSecret: true });
        assert.deepEqual(http.data.stagesToSkip, ["ManualApproval"]);
        assert.equal(output.result.runId, 808);
        assert.equal(pulse.payload.source.provider, "azure-pipelines");
        assert.doesNotMatch(output.lines.join("\n"), /private-azure-token|hidden/);
    });
});

test("new hosted CI Actions reject invalid contracts before making HTTP requests", { concurrency: false }, async () => {
    const state = { calls: 0 };
    const axios = { async post() { state.calls += 1; return { status: 200 }; } };

    await withModuleMocks({ axios: axios }, async () => {
        const github = loadFresh("TriggerGitHubActions.js");
        await captureConsole(async () => {
            await assert.rejects(github.handler({
                event: { ref: "main", inputs: [] },
                constants: {
                    GitHubOwner: "acme", GitHubRepository: "repo", GitHubWorkflow: "ci.yml", GitHubToken: "token",
                },
                triggers: [],
            }, {}, () => {}), { code: "CONTRACT_INVALID" });
        });

        const azure = loadFresh("TriggerAzurePipeline.js");
        await captureConsole(async () => {
            await assert.rejects(azure.handler({
                event: { stagesToSkip: "not-an-array" },
                constants: {
                    AzureDevOpsOrganization: "acme", AzureDevOpsProject: "project",
                    AzureDevOpsPipelineId: 1, AzureDevOpsToken: "token",
                },
                triggers: [],
            }, {}, () => {}), { code: "CONTRACT_INVALID" });
        });
    });

    assert.equal(state.calls, 0);
});

test("CircleCI uses the current pipeline-definition run endpoint", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const axios = { async post(url, data, options) {
        http.url = url; http.data = data; http.options = options;
        return { status: 201, data: { id: "circle-pipeline-1", state: "created" } };
    } };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const circle = loadFresh("TriggerCircleCIPipeline.js");
        const output = await captureConsole(() => circle.handler({
            event: { correlationId: "corr-circle", tag: "v2.0", configBranch: "main", parameters: { deploy: true } },
            constants: {
                CircleCIProvider: "github",
                CircleCIOrganization: "acme org",
                CircleCIProject: "widgets",
                CircleCIPipelineDefinitionId: "definition-1",
                CircleCIToken: "private-circle-token",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "https://circleci.com/api/v2/project/github/acme%20org/widgets/pipeline/run");
        assert.deepEqual(http.data, {
            definition_id: "definition-1",
            config: { branch: "main" },
            checkout: { tag: "v2.0" },
            parameters: { deploy: true },
        });
        assert.equal(http.options.headers["Circle-Token"], "private-circle-token");
        assert.equal(output.result.runId, "circle-pipeline-1");
        assert.equal(pulse.payload.source.provider, "circleci");
        assert.doesNotMatch(output.lines.join("\n"), /private-circle-token/);
    });
});

test("Bitbucket builds a branch target with optional commit, selector, and secured variables", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const axios = { async post(url, data, options) {
        http.url = url; http.data = data; http.options = options;
        return {
            status: 201,
            data: {
                uuid: "{pipeline-uuid}",
                build_number: 55,
                links: { html: { href: "https://bitbucket.org/acme/widgets/pipelines/results/55" } },
            },
        };
    } };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const bitbucket = loadFresh("TriggerBitbucketPipeline.js");
        const output = await captureConsole(() => bitbucket.handler({
            event: {
                correlationId: "corr-bitbucket", ref: "release/v2", commit: "abc123", selector: "security-scan",
                variables: { Environment: "qa", SecretValue: { value: "private-variable", secured: true } },
            },
            constants: {
                BitbucketWorkspace: "acme",
                BitbucketRepository: "widgets",
                BitbucketToken: "private-bitbucket-token",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "https://api.bitbucket.org/2.0/repositories/acme/widgets/pipelines");
        assert.equal(http.options.headers.Authorization, "Bearer private-bitbucket-token");
        assert.deepEqual(http.data.target, {
            type: "pipeline_ref_target", ref_type: "branch", ref_name: "release/v2",
            commit: { type: "commit", hash: "abc123" },
            selector: { type: "custom", pattern: "security-scan" },
        });
        assert.deepEqual(http.data.variables, [
            { key: "Environment", value: "qa", secured: false },
            { key: "SecretValue", value: "private-variable", secured: true },
        ]);
        assert.equal(output.result.runId, "{pipeline-uuid}");
        assert.equal(output.result.runNumber, 55);
        assert.equal(pulse.payload.source.provider, "bitbucket-pipelines");
        assert.doesNotMatch(output.lines.join("\n"), /private-bitbucket-token|private-variable/);
        assert.deepEqual(
            bitbucket.createRequestOptions({ username: "user@example.com", token: "api-token", timeoutMs: 9000 }).auth,
            { username: "user@example.com", password: "api-token" }
        );
    });
});

test("Buildkite creates a build with branch, commit, environment, and metadata", { concurrency: false }, async () => {
    const http = {};
    const pulse = {};
    const axios = { async post(url, data, options) {
        http.url = url; http.data = data; http.options = options;
        return { status: 201, data: { id: "buildkite-uuid", number: 9, web_url: "https://buildkite.com/acme/widgets/builds/9" } };
    } };

    await withModuleMocks({ axios: axios, "@qasymphony/pulse-sdk": createPulseSdk(pulse) }, async () => {
        const buildkite = loadFresh("TriggerBuildkiteBuild.js");
        const output = await captureConsole(() => buildkite.handler({
            event: {
                correlationId: "corr-buildkite", branch: "main", commit: "abc123", message: "Pulse dispatch",
                env: { TARGET: "qa", SECRET_VALUE: "private-variable" },
                metaData: { correlationId: "corr-buildkite" },
                author: { name: "qTest Pulse", email: "pulse@example.com" },
                cleanCheckout: true,
            },
            constants: {
                BuildkiteOrganization: "acme", BuildkitePipeline: "widgets", BuildkiteToken: "private-buildkite-token",
            },
            triggers: [{ name: "ChatOpsEvent" }],
        }, {}, () => {}));

        assert.equal(http.url, "https://api.buildkite.com/v2/organizations/acme/pipelines/widgets/builds");
        assert.equal(http.options.headers.Authorization, "Bearer private-buildkite-token");
        assert.deepEqual(http.data, {
            commit: "abc123", branch: "main", message: "Pulse dispatch",
            env: { TARGET: "qa", SECRET_VALUE: "private-variable" },
            meta_data: { correlationId: "corr-buildkite" },
            author: { name: "qTest Pulse", email: "pulse@example.com" },
            clean_checkout: true,
        });
        assert.equal(output.result.runId, "buildkite-uuid");
        assert.equal(output.result.runNumber, 9);
        assert.equal(pulse.payload.source.provider, "buildkite");
        assert.doesNotMatch(output.lines.join("\n"), /private-buildkite-token|private-variable/);
    });
});
