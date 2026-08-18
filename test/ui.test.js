// Force color off so the rendered strings are deterministic regardless of the
// environment running the tests. Must be set before requiring the module.
process.env.NO_COLOR = "1";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../src/ui");

test("visibleLength ignores ANSI escapes", () => {
  assert.equal(ui.visibleLength("\x1b[32mok\x1b[0m"), 2);
  assert.equal(ui.visibleLength("plain"), 5);
});

test("box draws rounded borders sized to the widest line", () => {
  const lines = ui.box(["ab", "abcd"]).split("\n");

  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith("╭") && lines[0].endsWith("╮"));
  assert.ok(lines[3].startsWith("╰") && lines[3].endsWith("╯"));

  // Widest content is "abcd" (4) plus one space of padding each side => 6 dashes.
  assert.equal((lines[0].match(/─/g) || []).length, 6);

  // Every rendered line has the same visible width.
  const width = ui.visibleLength(lines[0]);
  for (const line of lines) {
    assert.equal(ui.visibleLength(line), width);
  }
});
