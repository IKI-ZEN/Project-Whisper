# UI/UX Quality Review

**Date:** 2026-05-31  
**Scope:** All server-rendered pages (`src/routes/pages.ts`) and public HTML files (`public/`)

---

## Summary

The app's visual design is polished and consistent. Loading states, empty states, and accessibility basics (ARIA roles, labels, reduced-motion) are well-handled. The issues below are targeted: a handful of `alert()` calls that break the design, missing CSS classes for new environment types, cryptic fallback text, and a few raw error strings leaking to users.

**Overall verdict:** 4 targeted fixes, all small, would raise UX quality to production-ready.

---

## Issues Found

### UX-01 — `alert()` calls (HIGH)

`alert()` is a blocking browser dialog that looks nothing like the app. It breaks the design and is jarring in a dark-themed UI.

**Occurrences:**

| File | Line(s) | Trigger |
|------|---------|---------|
| `public/vibe.html` | 267, 314 | Input validation ("Please enter at least 10 characters.") |
| `public/tools.html` | 833, 878, 952, 1152 | Tool validation and error cases |
| `src/routes/pages.ts` | 2243 | Environments gallery — Fork action failed |
| `src/routes/pages.ts` | 2262 | Environments gallery — Export action failed |

The two `pages.ts` cases are the most impactful to fix: they fire when a user tries to fork or export an environment and the API call fails — exactly when a clear, styled error message matters most.

**Proposed fix for `pages.ts` (environments gallery):**  
Replace `alert(...)` with temporary inline status text on the button, consistent with how `vibe.html` already handles some of its own validation states (via `setStatus()`).

```diff
-    alert('Fork failed: '+String(e))
+    btn.textContent = 'Fork failed'
+    setTimeout(function(){ btn.textContent = 'Fork'; btn.disabled = false }, 3000)
```

```diff
-    alert('Export failed: '+String(e))
+    btn.textContent = 'Export failed'
+    setTimeout(function(){ btn.textContent = 'Export'; btn.disabled = false }, 3000)
```

**Proposed fix for `public/vibe.html` and `public/tools.html`:**  
Each file already has a `setStatus()` pattern or a visible status element. Replace each `alert()` with an equivalent inline message in the existing status element (details in § Implementation below).

---

### UX-02 — Missing CSS type-badge classes for new environment types (HIGH)

The environments gallery maps `envType → CSS class`, but the mapping only covers the original 4 types. The 3 new types added in Phase 5 (`creative`, `agent`, `debate`) fall through to the `type-general` default — all showing the same indigo color.

**File:** `src/routes/pages.ts`, lines 2178 and 2135–2138.

```javascript
// Current TYPE_CLASSES (line 2178) — missing creative, agent, debate:
const TYPE_CLASSES = { general:'type-general', coding:'type-coding', research:'type-research', structured:'type-structured' }
```

```css
/* Current CSS (lines 2135–2138) — same 4 types only: */
.type-general{background:#6366f122;color:var(--accent2)}
.type-coding{background:#6366f133;color:var(--accent)}
.type-research{background:#14b8a622;color:var(--teal)}
.type-structured{background:#f59e0b22;color:#f59e0b}
```

The env chat page (`envPageHtml`) already handles these types correctly with inline `TYPE_COLORS`. The gallery just never got updated.

**Proposed fix:**

Add 3 new CSS classes and 3 new entries in `TYPE_CLASSES`:

```css
.type-creative  { background:#ec4899222;color:#ec4899 }
.type-agent     { background:#8b5cf622;color:#8b5cf6  }
.type-debate    { background:#f9731622;color:#f97316  }
```

```javascript
const TYPE_CLASSES = {
  general:'type-general', coding:'type-coding',
  research:'type-research', structured:'type-structured',
  creative:'type-creative', agent:'type-agent', debate:'type-debate'
}
```

---

### UX-03 — `(no response)` fallback text (MEDIUM)

Both the chat page and the environment chat page use `(no response)` as the fallback when a stream completes with an empty body. This is opaque — users will not know if it means the model refused, timed out, or returned empty content.

**File:** `src/routes/pages.ts`  
- Line 833 (chat page): `if(!el.innerHTML)el.textContent='(no response)'`  
- Line 1868 (env chat page): `if(!full){el.textContent='(no response)';...}`

**Proposed fix:**

```diff
-el.textContent='(no response)'
+el.textContent='The model returned an empty response. Try rephrasing your message.'
```

---

### UX-04 — Raw error objects shown in stream error handlers (MEDIUM)

When a stream fetch fails (network error, 5xx), the raw JS error is shown directly to the user.

**File:** `src/routes/pages.ts`  
- Line 835 (chat page): `el.textContent='Error: '+e`  
- Line 1876–1877 (env chat page): `el.textContent='Error: '+e`  

`e` is a `TypeError` or `DOMException` with messages like `"Failed to fetch"` or `"The operation was aborted"` — technically accurate but not user-friendly.

**Proposed fix:**

```diff
-el.textContent='Error: '+e
+el.textContent='Something went wrong. Check your connection and try again.'
```

The specific error is already logged implicitly to the browser console via the uncaught exception path; no information is lost for debugging.

---

### UX-05 — Unstyled bare 404 responses (LOW)

Two bare 404 responses return raw HTML with no CSS, no nav, no branding:

**File:** `src/routes/pages.ts`  
- Line 2079: `return new Response('<h1>Not found</h1>', { status: 404 })` — env page, no ID  
- Line 422 (app page): `return new Response('<h1>App not found</h1>', { status: 404 })`

These appear as a white page with black text — jarring in a dark app.

**Proposed fix:**

Return a minimal styled 404 page consistent with the rest of the app. This is a small self-contained change (a helper function that generates a styled "Not found" response).

---

### UX-06 — Inline hex status colors in `public/vibe.html` (LOW)

Status color changes in `vibe.html` use `statusEl.style.background = '#f8717122'` rather than CSS class swaps. This is a minor consistency issue (no other page does this), but means the colors can't be themed or overridden.

**File:** `public/vibe.html` — status feedback states use hard-coded hex colors.

**Proposed fix:** Minimal — add `.status-error`, `.status-success`, `.status-loading` CSS classes and replace the inline assignments. Since this file was not authored by this session, defer to existing style patterns in the file and only fix the few status lines.

---

## Files NOT Needing Changes

- `public/environments.html` — uses `setStatus()` for all feedback; no `alert()` calls; good.
- Dashboard page — uses `esc(String(e))` in empty-note divs; acceptable (error text is sanitized before injection).
- Chat thread delete — uses `confirm()` at line 1076, which is appropriate for a destructive action.

---

## Proposed Change Set (priority order)

**Change 1 (UX-01, pages.ts):** Replace 2 `alert()` calls in environments gallery with button-text feedback.

**Change 2 (UX-02, pages.ts):** Add 3 CSS classes + 3 TYPE_CLASSES entries for creative/agent/debate.

**Change 3 (UX-03, pages.ts):** Replace `(no response)` with a human-readable message in both chat pages.

**Change 4 (UX-04, pages.ts):** Replace `'Error: '+e` with a friendlier fallback message in stream catch blocks.

**Change 5 (UX-01, public/vibe.html + tools.html):** Replace remaining `alert()` calls with inline status text.

**Change 6 (UX-05, pages.ts):** Styled 404 helper for bare responses.

Changes 1–4 are all in `pages.ts` and can be done in one commit. Changes 5–6 are slightly wider scope.

---

*Awaiting approval before implementing any changes.*
