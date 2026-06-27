<!-- SPDX-License-Identifier: Apache-2.0 -->

## Summary

<!-- What does this PR change, and why? Link any related issue, e.g. "Closes #7". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Docs only
- [ ] Tooling / CI / chore
- [ ] Fee-schedule extraction/generation tooling (see #15)

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass locally
- [ ] Added/updated tests for the change (domain logic must stay well-covered)
- [ ] Updated affected docs — no stale references left behind
- [ ] Source files carry the SPDX license header
- [ ] I did **not** hand-edit the generated `goae.json` / `goz.json` / `got.json`
      tables (data errors are reported as issues, not edited in PRs — see
      [CONTRIBUTING](../CONTRIBUTING.md#fee-schedule-data-goägozgot))

## Privacy impact

<!-- Required. State "none" if not applicable. The constraints below are non-negotiable. -->

- [ ] No invoice images or raw OCR text are sent to the backend
- [ ] No server-side AI/LLM was introduced
- [ ] No third-party runtime dependency / external CDN / analytics was added

## Reviewer note

> This repository requires a review and approval from the maintainer
> (@justb81) before merge — see [CODEOWNERS](../CODEOWNERS). Thanks for your
> patience!
