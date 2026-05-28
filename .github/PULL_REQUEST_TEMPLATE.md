## Summary

<!--
1–3 bullet points: what changed and why.
-->

-
-
-

## Type of change

<!-- Tick all that apply. -->

- [ ] Bug fix
- [ ] New feature
- [ ] Security fix
- [ ] Refactor (no behaviour change)
- [ ] Documentation

## Checklist

<!-- Every box must be checked before this PR is merged. -->

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] New JSON-body routes use `parseBody(req, parser)` — no raw `req.json()`
- [ ] User-supplied `:id` / `:imageId` params validated as UUID before R2 or DO access
- [ ] New magic numbers added to `src/lib/constants.ts`, not inline
- [ ] New DO calls use `https://do/` (not `http://do`)
- [ ] New mutation endpoints added to `isProtectedRequest()` in `src/lib/access.ts` if they require Access protection
- [ ] CLAUDE.md updated if new routes, bindings, or behaviour were added

## Testing

<!--
Describe how the change was verified: manual steps taken, endpoints called,
edge cases exercised, and what the expected vs. actual output was.
-->
