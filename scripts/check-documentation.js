const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules"]);
const ruleDirectories = ["chatops", "citools", "parsers", "qtest"];
const retiredExternalTargets = [
    "https://api.qasymphony.com/",
    "https://docs.microsoft.com/",
    "https://github.com/QASymphony/PulseRules_v9.1",
];

function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (ignoredDirectories.has(entry.name)) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walk(entryPath));
        else files.push(entryPath);
    }

    return files;
}

function toRepositoryPath(filePath) {
    return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function githubSlug(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/[`*~]/g, "")
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .replace(/\s+/g, "-");
}

function collectHeadingAnchors(markdown) {
    const anchors = new Set();
    const counts = new Map();

    for (const line of markdown.split(/\r?\n/)) {
        const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
        if (!match) continue;
        const base = githubSlug(match[1]);
        const count = counts.get(base) || 0;
        counts.set(base, count + 1);
        anchors.add(count === 0 ? base : `${base}-${count}`);
    }

    return anchors;
}

function extractTargets(markdown) {
    const targets = [];
    const markdownLink = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    const htmlLink = /<(?:a|img)\b[^>]*\b(?:href|src)=["']([^"']+)["']/gi;

    for (const pattern of [markdownLink, htmlLink]) {
        for (const match of markdown.matchAll(pattern)) targets.push(match[1]);
    }

    return targets;
}

function checkMarkdownFile(filePath, errors) {
    const markdown = fs.readFileSync(filePath, "utf8");
    const sourcePath = toRepositoryPath(filePath);

    if (/[A-Za-z]:\\Users\\/i.test(markdown)) {
        errors.push(`${sourcePath}: contains a user-specific absolute Windows path.`);
    }

    for (const target of extractTargets(markdown)) {
        if (/^(?:mailto:|data:)/i.test(target)) continue;

        if (/^https?:\/\//i.test(target)) {
            const retired = retiredExternalTargets.find((prefix) => target.startsWith(prefix));
            if (retired) errors.push(`${sourcePath}: uses retired external target '${target}'.`);
            continue;
        }

        const hashIndex = target.indexOf("#");
        const encodedPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
        const encodedAnchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
        const queryFreePath = encodedPath.split("?", 1)[0];
        let decodedPath;
        let decodedAnchor;

        try {
            decodedPath = decodeURIComponent(queryFreePath);
            decodedAnchor = decodeURIComponent(encodedAnchor);
        } catch (error) {
            errors.push(`${sourcePath}: link target '${target}' is not valid percent-encoding.`);
            continue;
        }

        const destinationPath = decodedPath
            ? path.resolve(path.dirname(filePath), decodedPath)
            : filePath;

        if (!fs.existsSync(destinationPath)) {
            errors.push(`${sourcePath}: local target '${target}' does not exist.`);
            continue;
        }

        if (decodedAnchor && path.extname(destinationPath).toLowerCase() === ".md") {
            const destinationMarkdown = fs.readFileSync(destinationPath, "utf8");
            const anchors = collectHeadingAnchors(destinationMarkdown);
            if (!anchors.has(decodedAnchor.toLowerCase())) {
                errors.push(`${sourcePath}: anchor '#${decodedAnchor}' does not exist in '${toRepositoryPath(destinationPath)}'.`);
            }
        }
    }
}

function getLeadingDocumentationComment(source) {
    const match = source.match(/^\s*(\/\*\*[\s\S]*?\*\/)/);
    return match ? match[1] : null;
}

function checkRuleHeader(filePath, errors) {
    const source = fs.readFileSync(filePath, "utf8");
    const sourcePath = toRepositoryPath(filePath);
    const header = getLeadingDocumentationComment(source);

    if (!header) {
        errors.push(`${sourcePath}: must begin with a /** usage documentation block.`);
        return;
    }

    if (!/(?:Input|Event|Payload)\s*:/i.test(header)) {
        errors.push(`${sourcePath}: leading usage block must describe the input event/payload.`);
    }

    if (!/Constants?\s*:/i.test(header)) {
        errors.push(`${sourcePath}: leading usage block must describe Constants or state that there are none.`);
    }
}

const errors = [];
const allFiles = walk(repositoryRoot);
const markdownFiles = allFiles.filter((filePath) => path.extname(filePath).toLowerCase() === ".md");

for (const filePath of markdownFiles) checkMarkdownFile(filePath, errors);

const ruleFiles = ruleDirectories.flatMap((directory) =>
    walk(path.join(repositoryRoot, directory)).filter(
        (filePath) => path.extname(filePath).toLowerCase() === ".js"
    )
);

for (const filePath of ruleFiles) checkRuleHeader(filePath, errors);

if (errors.length > 0) {
    console.error("Documentation validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log(
        `Documentation checks passed for ${markdownFiles.length} Markdown file(s) and ${ruleFiles.length} Pulse rule(s).`
    );
}
