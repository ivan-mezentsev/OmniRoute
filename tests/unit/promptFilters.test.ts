import test from "node:test";
import assert from "node:assert/strict";

import type { PromptFilter } from "../../src/lib/promptFilters/types.ts";

const { applyPromptFiltersToBody } = await import("../../src/lib/promptFilters/engine.ts");

type MessageBody = { messages: Array<{ role: string; content: string }> };
type ResponsesBody = {
  instructions?: string;
  input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
};
type ClaudeSystemBlocksBody = { system: Array<{ type: string; text: string }> };
type FixtureBody = { input: Array<{ content: Array<{ text: string }> }> };

function filter(overrides: Partial<PromptFilter> = {}): PromptFilter {
  return {
    id: "filter-1",
    name: "Copilot cleanup",
    enabled: true,
    uaPatterns: ["Copilot*"],
    blocks: [{ id: "block-1", text: "NEVER say the name of a tool to a user." }],
    applyTo: "system" as const,
    matchCount: 0,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

test("matches User-Agent wildcards case-insensitively", () => {
  const body = {
    messages: [
      { role: "system", content: "Keep this. NEVER say the name of a tool to a user." },
    ],
  };

  const result = applyPromptFiltersToBody(body, "copilotchat/1.2", [filter()]);

  assert.equal(result.changed, true);
  assert.equal(result.totalRemovals, 1);
  assert.equal((result.body as MessageBody).messages[0].content, "Keep this. ");
});

test("plain UA patterns match as substrings", () => {
  const body = {
    messages: [{ role: "system", content: "OpenCode identity survives?" }],
  };
  const result = applyPromptFiltersToBody(body, "Custom OpenCode Client", [
    filter({
      uaPatterns: ["OpenCode"],
      blocks: [{ id: "block-1", text: "OpenCode identity" }],
    }),
  ]);

  assert.equal(result.changed, true);
  assert.equal((result.body as MessageBody).messages[0].content, " survives?");
});

test("literal backslash-n patterns match real line breaks and flexible whitespace", () => {
  const body = {
    messages: [
      {
        role: "system",
        content: "Alpha\n\tBeta    Gamma\nDelta",
      },
    ],
  };

  const result = applyPromptFiltersToBody(body, "Copilot/1", [
    filter({ blocks: [{ id: "block-1", text: "Alpha\\n Beta Gamma" }] }),
  ]);

  assert.equal(result.changed, true);
  assert.equal((result.body as MessageBody).messages[0].content, "\nDelta");
});

test("JSON-escaped quotes in copied log chunks match parsed payload quotes", () => {
  const body = {
    messages: [
      {
        role: "system",
        content:
          'NEVER say the name of a tool to a user. For example, instead of saying that you\'ll use the run_in_terminal tool, say "I\'ll run the command in a terminal".\nNext line stays.',
      },
    ],
  };

  const result = applyPromptFiltersToBody(body, "GitHubCopilotChat/1.0", [
    filter({
      blocks: [
        {
          id: "block-1",
          text: 'NEVER say the name of a tool to a user. For example, instead of saying that you\'ll use the run_in_terminal tool, say \\"I\'ll run the command in a terminal\\".\\n',
        },
      ],
    }),
  ]);

  assert.equal(result.changed, true);
  assert.equal(result.totalRemovals, 1);
  assert.equal((result.body as MessageBody).messages[0].content, "\nNext line stays.");
});

test("Copilot star patterns match Copilot tokens inside longer User-Agent strings", () => {
  const body = {
    messages: [{ role: "system", content: "REMOVE inside longer UA" }],
  };

  const result = applyPromptFiltersToBody(body, "GitHubCopilotChat/1.0", [
    filter({ blocks: [{ id: "block-1", text: "REMOVE" }] }),
  ]);

  assert.equal(result.changed, true);
  assert.equal((result.body as MessageBody).messages[0].content, " inside longer UA");
});

test("system scope skips user content and all scope removes user content", () => {
  const body = {
    messages: [
      { role: "system", content: "system keep" },
      { role: "user", content: "REMOVE ME" },
    ],
  };

  const systemOnly = applyPromptFiltersToBody(body, "Copilot/1", [
    filter({ blocks: [{ id: "block-1", text: "REMOVE ME" }], applyTo: "system" }),
  ]);
  assert.equal(systemOnly.changed, false);
  assert.equal((systemOnly.body as MessageBody).messages[1].content, "REMOVE ME");

  const allMessages = applyPromptFiltersToBody(body, "Copilot/1", [
    filter({ blocks: [{ id: "block-1", text: "REMOVE ME" }], applyTo: "all" }),
  ]);
  assert.equal(allMessages.changed, true);
  assert.equal((allMessages.body as MessageBody).messages[1].content, "");
});

test("removes from Responses API instructions and input text blocks", () => {
  const body = {
    instructions: "Remove this developer rule. Keep suffix.",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: "Do not mention tools. Keep." }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: "User block REMOVE ME too." }],
      },
    ],
  };

  const result = applyPromptFiltersToBody(body, "OpenCode/0.1", [
    filter({
      uaPatterns: ["OpenCode*"],
      applyTo: "all",
      blocks: [
        { id: "block-1", text: "Remove this developer rule." },
        { id: "block-2", text: "Do not mention tools." },
        { id: "block-3", text: "REMOVE ME" },
      ],
    }),
  ]);

  assert.equal(result.totalRemovals, 3);
  assert.equal(result.body.instructions, " Keep suffix.");
  assert.equal((result.body as ResponsesBody).input[0].content[0].text, " Keep.");
  assert.equal((result.body as ResponsesBody).input[1].content[0].text, "User block  too.");
});

test("removes from Claude system string and block arrays", () => {
  const stringResult = applyPromptFiltersToBody(
    { system: "Claude system REMOVE", messages: [{ role: "user", content: "hi" }] },
    "Copilot/1",
    [filter({ blocks: [{ id: "block-1", text: "REMOVE" }] })]
  );
  assert.equal(stringResult.body.system, "Claude system ");

  const blockResult = applyPromptFiltersToBody(
    { system: [{ type: "text", text: "Claude block REMOVE" }] },
    "Copilot/1",
    [filter({ blocks: [{ id: "block-1", text: "REMOVE" }] })]
  );
  assert.equal((blockResult.body as ClaudeSystemBlocksBody).system[0].text, "Claude block ");
});

test("application is deterministic and does not mutate the original body", () => {
  const body = {
    messages: [{ role: "developer", content: "A NEVER say the name of a tool to a user. B" }],
  };

  const first = applyPromptFiltersToBody(body, "Copilot/1", [filter()]);
  const second = applyPromptFiltersToBody(body, "Copilot/1", [filter()]);

  assert.deepEqual(first.body, second.body);
  assert.equal(body.messages[0].content, "A NEVER say the name of a tool to a user. B");
});

test("removal preserves indentation outside the excised junction", () => {
  const body = {
    messages: [
      {
        role: "system",
        content:
          "Keep list:\n  - item one\n    - nested item\nREMOVE THIS LINE\nCode:\n\tindented code\n  trailing list",
      },
    ],
  };

  const result = applyPromptFiltersToBody(body, "Copilot/1", [
    filter({ blocks: [{ id: "block-1", text: "REMOVE THIS LINE" }] }),
  ]);

  assert.equal(result.changed, true);
  // The excised line leaves one blank line at the junction; indentation of
  // surrounding list/code lines is preserved byte-for-byte.
  assert.equal(
    (result.body as MessageBody).messages[0].content,
    "Keep list:\n  - item one\n    - nested item\n\nCode:\n\tindented code\n  trailing list"
  );
});

test("removes multiple blocks from the same plain-string input element", () => {
  const body = {
    input: ["FIRST CHUNK keep middle SECOND CHUNK"],
  };

  const result = applyPromptFiltersToBody(body, "Copilot/1", [
    filter({
      applyTo: "all",
      blocks: [
        { id: "block-1", text: "FIRST CHUNK" },
        { id: "block-2", text: "SECOND CHUNK" },
      ],
    }),
  ]);

  assert.equal(result.totalRemovals, 2);
  assert.equal((result.body as { input: string[] }).input[0], " keep middle ");
});

test("escaped backslash sequences and Windows paths stay literal in patterns", () => {
  // `\\\\n` in user input (backslash + backslash + n) must match a literal
  // backslash followed by "n", not a newline.
  const literalBody = {
    messages: [{ role: "system", content: "value is \\n literal here" }],
  };
  const literalResult = applyPromptFiltersToBody(literalBody, "Copilot/1", [
    filter({ blocks: [{ id: "block-1", text: "value is \\\\n literal" }] }),
  ]);
  assert.equal(literalResult.changed, true);
  assert.equal((literalResult.body as MessageBody).messages[0].content, " here");

  // `\b` / `\f` in a raw Windows path must not become control characters.
  const pathBody = {
    messages: [{ role: "system", content: "Run C:\\bin\\foo.exe now. Keep." }],
  };
  const pathResult = applyPromptFiltersToBody(pathBody, "Copilot/1", [
    filter({ blocks: [{ id: "block-1", text: "Run C:\\bin\\foo.exe now." }] }),
  ]);
  assert.equal(pathResult.changed, true);
  assert.equal((pathResult.body as MessageBody).messages[0].content, " Keep.");
});

test("inline Responses payload supports real Copilot instruction removal", () => {
  const body = {
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "No need to ask permission before using a tool.\n" +
              "NEVER say the name of a tool to a user.\n" +
              "Continue with the requested implementation.",
          },
        ],
      },
    ],
  };
  const block = "NEVER say the name of a tool to a user.";

  const result = applyPromptFiltersToBody(body, "CopilotChat/1.0", [
    filter({ blocks: [{ id: "block-1", text: block }] }),
  ]);

  const text = (result.body as FixtureBody).input[0].content[0].text;
  assert.equal(result.changed, true);
  assert.equal(result.totalRemovals, 1);
  assert.ok(!text.includes(block));
  assert.ok(text.includes("No need to ask permission before using a tool."));
});
