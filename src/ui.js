const pc = require("picocolors");

// Decorative output (boxes, indentation) is only drawn for an interactive
// terminal. When piped or redirected we fall back to plain lines. picocolors
// independently strips color when NO_COLOR is set or the stream is not a TTY.
function isInteractive() {
  return Boolean(process.stderr.isTTY);
}

// Matches ANSI SGR color escapes so we can measure visible width.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// Visible width of a string, ignoring ANSI color escapes.
function visibleLength(str) {
  return str.replace(ANSI_PATTERN, "").length;
}

const symbols = {
  ok: pc.green("✔"),
  err: pc.red("✖"),
  warn: pc.yellow("⚠"),
  bullet: pc.dim("•"),
  arrow: pc.dim("→"),
};

// A left-aligned "✔ label   value" status line.
function status(symbol, label, value) {
  const parts = [symbol, label];

  if (value !== undefined) {
    parts.push(pc.dim(value));
  }

  return `  ${parts.join("  ")}`;
}

/**
 * Draws a rounded box around the given lines, auto-sized to the widest line.
 * Lines may already contain ANSI color; width is measured on visible glyphs.
 */
function box(lines, color = pc.cyan) {
  const inner = Math.max(...lines.map(visibleLength));
  const horizontal = "─".repeat(inner + 2);

  const top = color(`╭${horizontal}╮`);
  const bottom = color(`╰${horizontal}╯`);

  const body = lines.map((line) => {
    const pad = " ".repeat(inner - visibleLength(line));

    return `${color("│")} ${line}${pad} ${color("│")}`;
  });

  return [top, ...body, bottom].join("\n");
}

module.exports = {
  pc,
  symbols,
  status,
  box,
  isInteractive,
  visibleLength,
};
