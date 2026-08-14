const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const actionDirectories = ["chatops", "citools", "parsers", "qtest"];
const commonJsModules = new Set([
    "@qasymphony/pulse-sdk",
    "@qasymphony/scenario-sdk",
    "axios",
    "cors",
    "query-string",
    "request",
    "xml2js",
]);
const esmModules = new Set([...commonJsModules, "buffer"]);

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
}

function findModuleNames(source, pattern) {
    return Array.from(source.matchAll(pattern), (match) => match[1]);
}

test("deployable Pulse Actions import only modules exposed by the QuickJS sandbox", () => {
    const violations = [];
    const actionFiles = actionDirectories.flatMap((directory) =>
        walk(path.join(repositoryRoot, directory)).filter((filePath) => filePath.endsWith(".js"))
    );

    for (const filePath of actionFiles) {
        const source = fs.readFileSync(filePath, "utf8");
        const requiredModules = findModuleNames(
            source,
            /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
        );
        const importedModules = findModuleNames(
            source,
            /\bimport\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g
        );

        for (const moduleName of requiredModules) {
            if (!commonJsModules.has(moduleName)) {
                violations.push(`${path.relative(repositoryRoot, filePath)}: require(${JSON.stringify(moduleName)})`);
            }
        }
        for (const moduleName of importedModules) {
            if (!esmModules.has(moduleName)) {
                violations.push(`${path.relative(repositoryRoot, filePath)}: import ${JSON.stringify(moduleName)}`);
            }
        }
    }

    assert.deepEqual(violations, []);
});
