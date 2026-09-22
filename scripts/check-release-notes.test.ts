import { describe, expect, it } from "vitest";

import {
  extractChangelogSection,
  hasReleaseNotesInMetadata,
  hasUsableReleaseNotes,
} from "./check-release-notes.mjs";

describe("release note validation", () => {
  it("accepts non-empty source notes", () => {
    expect(hasUsableReleaseNotes("\nBug fixes\n")).toBe(true);
    expect(hasUsableReleaseNotes("   ")).toBe(false);
  });

  it("extracts only the matching changelog version", () => {
    const changelog = [
      "# Changelog",
      "",
      "## [1.3.0] - 2026-09-16",
      "",
      "### Added",
      "",
      "- Pantry improvements.",
      "",
      "## [1.2.7] - 2026-09-08",
      "",
      "- Older changes.",
      "",
    ].join("\n");

    expect(extractChangelogSection(changelog, "1.3.0")).toBe(
      "### Added\n\n- Pantry improvements.\n"
    );
  });

  it("rejects missing, duplicate, malformed, and empty changelog entries", () => {
    const valid = "## [1.3.0] - 2026-09-16\n\n- A change.\n";
    expect(() => extractChangelogSection(valid, "1.2.0")).toThrow("no entry");
    expect(() => extractChangelogSection(`${valid}\n${valid}`, "1.3.0")).toThrow("duplicate");
    expect(() => extractChangelogSection("## [1.3.0]\n\n- A change.\n", "1.3.0")).toThrow(
      "valid ISO date"
    );
    expect(() => extractChangelogSection("## [1.3.0] - 2026-09-16\n\n### Added\n", "1.3.0")).toThrow(
      "meaningful"
    );
  });

  it("normalizes CRLF changelog input", () => {
    expect(extractChangelogSection("## [1.3.0] - 2026-09-16\r\n\r\n- Fixed.\r\n", "1.3.0")).toBe(
      "- Fixed.\n"
    );
  });

  it("accepts inline and block release notes in latest.yml", () => {
    expect(hasReleaseNotesInMetadata("version: 1.4.0\nreleaseNotes: Bug fixes\n")).toBe(true);
    expect(
      hasReleaseNotesInMetadata("version: 1.4.0\nreleaseNotes: |-\n  ### Fixed\n  - Bug fixes\n")
    ).toBe(true);
  });

  it("rejects missing or empty release notes in latest.yml", () => {
    expect(hasReleaseNotesInMetadata("version: 1.4.0\n")).toBe(false);
    expect(hasReleaseNotesInMetadata("version: 1.4.0\nreleaseNotes: |\n")).toBe(false);
  });
});