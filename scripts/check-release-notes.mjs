import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const packagePath = path.join(projectRoot, "package.json");
const changelogPath = path.join(projectRoot, "CHANGELOG.md");
const sourcePath = path.join(projectRoot, "release-notes-windows.md");
const artifactPath = path.join(projectRoot, "dist", "latest.yml");

export function hasUsableReleaseNotes(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasMeaningfulChangelogNotes(value) {
  return value
    .split(/\r?\n/)
    .some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function extractChangelogSection(content, version) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const headings = [...normalized.matchAll(/^## \[([^\]]+)\](?: - (.*))?\s*$/gm)];
  const versionHeadings = headings.filter((heading) => heading[1] === version);

  if (versionHeadings.length !== 1) {
    throw new Error(
      versionHeadings.length === 0
        ? `CHANGELOG.md has no entry for version ${version}.`
        : `CHANGELOG.md has duplicate entries for version ${version}.`
    );
  }

  const heading = versionHeadings[0];
  if (!heading[2] || !isValidIsoDate(heading[2].trim())) {
    throw new Error(`CHANGELOG.md entry for version ${version} must include a valid ISO date.`);
  }

  const start = heading.index + heading[0].length;
  const nextHeading = headings.find((candidate) => candidate.index > heading.index);
  const notes = normalized.slice(start, nextHeading?.index ?? normalized.length).trim();
  if (!hasUsableReleaseNotes(notes) || !hasMeaningfulChangelogNotes(notes)) {
    throw new Error(`CHANGELOG.md entry for version ${version} has no meaningful release notes.`);
  }

  return `${notes}\n`;
}

export async function prepareReleaseNotes({
  packageFilePath = packagePath,
  changelogFilePath = changelogPath,
  outputPath = sourcePath,
} = {}) {
  const packageJson = JSON.parse(await fs.readFile(packageFilePath, "utf8"));
  const version = typeof packageJson.version === "string" ? packageJson.version.trim() : "";
  if (!version) throw new Error("package.json does not contain a release version.");

  const changelog = await fs.readFile(changelogFilePath, "utf8");
  const notes = extractChangelogSection(changelog, version);
  await fs.writeFile(outputPath, notes, "utf8");
  return { outputPath, version, notes };
}

export function hasReleaseNotesInMetadata(metadata) {
  const lines = metadata.split(/\r?\n/);
  const releaseNotesIndex = lines.findIndex((line) => /^releaseNotes:\s*/.test(line));
  if (releaseNotesIndex === -1) return false;

  const value = lines[releaseNotesIndex].replace(/^releaseNotes:\s*/, "").trim();
  if (value && !["|", "|-", "|+", ">", ">-", ">+"].includes(value)) {
    return hasUsableReleaseNotes(value.replace(/^['"]|['"]$/g, ""));
  }

  const noteLines = [];
  for (const line of lines.slice(releaseNotesIndex + 1)) {
    if (/^\S/.test(line) && line.trim()) break;
    noteLines.push(line.replace(/^\s+/, ""));
  }
  return hasUsableReleaseNotes(noteLines.join("\n"));
}

export async function validateSource(filePath = sourcePath) {
  let notes;
  try {
    notes = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Required release notes file is missing: ${filePath}`, { cause: error });
  }
  if (!hasUsableReleaseNotes(notes)) {
    throw new Error(`Required release notes file is empty: ${filePath}`);
  }
}

export async function validateArtifact(filePath = artifactPath) {
  let metadata;
  try {
    metadata = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Updater metadata file is missing: ${filePath}`, { cause: error });
  }
  if (!hasReleaseNotesInMetadata(metadata)) {
    throw new Error(`Updater metadata has no usable releaseNotes: ${filePath}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  try {
    if (mode === "--prepare") {
      const result = await prepareReleaseNotes();
      console.log(`Generated release notes for ${result.version}: ${result.outputPath}`);
    } else if (mode === "--artifact") {
      await validateArtifact();
      console.log(`Validated updater metadata: ${artifactPath}`);
    } else {
      throw new Error("Usage: node scripts/check-release-notes.mjs --prepare|--artifact");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}