# Product Sense

This doc captures taste and product judgment for Kaicho. When making
decisions that aren't covered by a spec, use these principles.

## Who is the user?

A developer who pays for multiple AI coding tools and wants to extract value
from all of them. They are pragmatic, busy, and uninterested in dashboards or
configuration ceremony. They want structured signal, not raw noise.

## Product principles

### 1. Signal over noise
The user doesn't want to read four agents' raw output. They want the
intersection: what do multiple agents agree on? What's unique to one?
Deduplication and categorization are the product, not a feature.

### 2. Zero-config by default
Point at a repo, get suggestions. No YAML manifests, no agent configuration
files, no setup wizards. Sensible defaults for everything. Power users can
override, but the default path is: `kaicho run .`

### 3. Incremental, not ambitious
Ship the smallest useful thing. A CLI that runs one agent and prints
structured output is more valuable today than a multi-agent orchestration
platform that's half-built.

### 4. Respect human attention
Don't surface 200 suggestions. Surface the 10 that matter. Categorize by
severity, deduplicate across agents, and let the user drill down if they
want more.

### 5. Agent output is untrusted
Agents hallucinate, produce malformed output, and disagree with each other.
The product must handle all of this gracefully — never crash on bad agent
output, always surface confidence levels.

### 6. Multi-agent is the differentiator
A single-agent review tool is a wrapper. Kaicho's value is cross-agent
synthesis: running Claude, Codex, Gemini, and Cursor against the same code
and producing a unified view.
