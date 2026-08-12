const { readdirSync, statSync } = require("fs");
const { join, relative } = require("path");
const { spawnSync } = require("child_process");

const repositoryRoot = join(__dirname, "..");
const excludedDirectories = new Set([".git", "node_modules"]);

function findJavaScriptFiles(directory) {
    return readdirSync(directory).flatMap((name) => {
        const fullPath = join(directory, name);
        const relativePath = relative(repositoryRoot, fullPath);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
            return excludedDirectories.has(name) ? [] : findJavaScriptFiles(fullPath);
        }

        return relativePath.endsWith(".js") ? [relativePath] : [];
    });
}

const failures = [];
const files = findJavaScriptFiles(repositoryRoot).sort();

for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
        cwd: repositoryRoot,
        encoding: "utf8",
    });

    if (result.status !== 0) {
        failures.push({ file: file, output: result.stderr || result.stdout });
    }
}

if (failures.length > 0) {
    failures.forEach((failure) => {
        console.error(`Syntax check failed: ${failure.file}`);
        console.error(failure.output.trim());
    });
    process.exitCode = 1;
} else {
    console.log(`Syntax checks passed for ${files.length} JavaScript file(s).`);
}
