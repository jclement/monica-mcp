import { describe, expect, test } from "bun:test";
import { MONICA_TOOLS, MONICA_TOOLS_BY_NAME } from "../src/monica/tools.ts";

describe("monica tool descriptions", () => {
  test("create_reminder documents the real Monica fields (not guesses)", () => {
    const tool = MONICA_TOOLS_BY_NAME.get("create_reminder")!;
    expect(tool).toBeDefined();
    // The fields the agent previously had to guess at — these must be spelled out.
    for (const needle of ["next_expected_date", "frequency_type", "one_time", "contact_id"]) {
      expect(tool.description).toContain(needle);
    }
    // It guessed `initial_date`; that field does not exist in Monica's API.
    expect(tool.description).not.toContain("initial_date");
    // The `data` schema carries the same guidance for agents that read arg schemas.
    expect((tool.inputSchema.properties as any).data.description).toContain("frequency_type");
  });

  test("every create_/update_ tool ships field guidance, not a docs pointer", () => {
    const writers = MONICA_TOOLS.filter((t) => /^(create|update)_/.test(t.name));
    expect(writers.length).toBeGreaterThan(0);
    for (const tool of writers) {
      const dataDesc = (tool.inputSchema.properties as any).data.description as string;
      // No tool should fall back to "see the Monica API docs" — that's what left
      // the agent guessing. Each writer enumerates its fields instead.
      expect(tool.description).not.toContain("Monica API docs");
      expect(dataDesc).toMatch(/required:/);
    }
  });
});
