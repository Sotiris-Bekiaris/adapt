## What changed

<!-- One or two sentences. If this fixes an issue, say "Fixes #N". -->

## Why

<!-- The problem, not the patch. For docs fixes: which file/line disagreed with which source file. -->

## Checklist

- [ ] `npm run check` passes (typecheck clean, whole vitest suite green)
- [ ] `npm run schemas` produces no git diff (required if `src/config/schema.ts` or `src/scenarios/schema.ts` changed)
- [ ] Tests added or updated in the mirrored `test/` path; agent behaviour is tested against `StubEngine`, never a live model
- [ ] Any change under `src/agents/prompts/` has a matching assertion in `test/agents/` — and the description below says what behaviour changed and why removing a constraint is safe
- [ ] README / docs updated if a CLI flag, config key, or documented default changed
- [ ] `readme.html` (the published project page) mirrored by hand if that fact also appears there — README.md is the source of truth, nothing checks the HTML for you
- [ ] No new runtime dependency, or the description justifies it
- [ ] No secrets, tokens, or absolute local paths in the diff; no `.adapt/` artifacts or `state.db` files committed
- [ ] Does not let the implementing agent verify its own fix, weaken a scenario's expected outcome, delete passing scenarios, or put a human approval step inside the loop
