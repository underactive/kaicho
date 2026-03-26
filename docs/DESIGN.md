# Design & Frontend Conventions

Kaicho is primarily a CLI tool. This doc covers terminal output design and
any future UI conventions.

## CLI output principles

1. **Structured by default.** Output JSON when piped (`--json` flag or
   stdout is not a TTY). Human-readable tables when interactive.
2. **Progressive detail.** Default output is a summary. `--verbose` adds
   detail. `--debug` adds agent raw output.
3. **Color is informational.** Use color to encode severity/category, not
   for decoration. Respect `NO_COLOR` env var.
4. **No spinners in non-TTY.** Progress indicators only in interactive mode.

## Suggestion display format

When displaying suggestions to the user:

```
[severity] category — file:line
  rationale (truncated to 1 line)
  ▸ suggested change (if available)
```

Group by file, sort by severity within each file.

## Future UI considerations

If Kaicho grows a web UI or TUI:
- Follow the same progressive-disclosure pattern: summary first, drill down
- Agent attribution should be visible but not dominant
- Cross-agent agreement/disagreement is the primary visual signal
