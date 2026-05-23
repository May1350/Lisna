---
name: Pitfall discovery
about: A bug we paid for — capture it as a future-proofing rule
title: "pitfall: "
labels: pitfall, claude-rule
assignees: ''
---

## The bug

One sentence. Where, what symptom.

## Root cause

Why it happened. Be specific (e.g., "MediaRecorder emits WebM, Groq Whisper only accepts WAV").

## How we caught it

CloudWatch? User report? Local repro? Approx hours lost.

## Proposed rule

Format for `.claude/rules/pitfalls.md`:

```
- [YYYY-MM-DD] (subcategory) <one-line rule>. Reason: <one-clause why>.
  last-cited: YYYY-MM-DD
```

## Acceptance

- [ ] `/learn` proposed → rule added to `.claude/rules/pitfalls.md`
- [ ] Code change (if any) merged
- [ ] HANDOFF.md §6 / §5 updated
