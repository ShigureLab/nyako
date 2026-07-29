---
name: paddlepaddle-contribution-guidelines
description: PaddlePaddle-specific CI facts for an authorized implementation or PR follow-up.
---

# PaddlePaddle Contribution Notes

The target repository's current instructions and PR template are authoritative.

- Focus on required checks and failures causally related to the changed files.
- Treat approval gates as review state, not as code failures.
- Fix deterministic CodeStyle and Static-Check regressions caused by the PR.
- Diagnose unrelated failures and report evidence; rerun them only when the active Session task
  allows that GitHub write.
- Use the repository's installed formatter and targeted tests before pushing.
- A follow-up stays on the existing PR branch unless the task explicitly asks for a separate PR.
