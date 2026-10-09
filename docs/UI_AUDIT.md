# UI audit scope

The UI audits are regression guards for trusted, reviewed MM_LLM source. They catch accidental changes to the approved theme-token contract, contrast pairs, audited selector mappings, and startup-theme order. Passing them means the checked source still matches those explicit contracts; it is not a formal proof of every browser behavior or every possible cascade.

## Run the checks

Run the fast CSS audit while editing styles:

```bash
npm run ui:audit
```

Run the complete UI audit and its mutation fixtures:

```bash
node --test tests/ui-design.test.mjs
```

Before merging, run the surrounding security and build checks as well:

```bash
node --test tests/security-policy.test.mjs
npm test
npm run typecheck
npm run build
```

`npm run ui:audit` checks the real stylesheet. The mutation fixtures in `tests/ui-design.test.mjs` prove that the audit rejects each required regression class below. Adding a new audited contract requires both an implementation check and a mutation that demonstrates the check fails when that contract is broken.

## Required mutation coverage

The current CSS mutation suite must reject:

- raw, escaped, named, system, and modern color values outside the theme roots;
- alternate dark selectors, dark classes, and dark media-query overrides;
- font sizes below 12 px, context-dependent or unverified size paths, size-bearing font shorthand, and local typography-token redefinitions;
- local color-token redefinitions, duplicate light or dark theme roots, asymmetric theme tokens, and legacy aliases;
- missing, later-conflicting, or structurally stronger disabled-state and control-boundary mappings, including typed, stateful, escaped, and `:is()` selector variants represented by the fixtures;
- broken non-text accent contrast, stop-button and active-navigation semantic mappings, and active-navigation descendant overrides;
- broken speaker-token contrast, duplicate speaker colors, incorrect speaker mappings, and categorical color applied to speaker-name text;
- broken Console palette contrast: body text, tertiary text on hover/subtle/selected surfaces, accent text and accent graphics on every surface they sit on, success badges, and text on both amber faces (`on-accent` against `accent` and `accent-hover`); the amber face itself is face-only and is deliberately not held to 3:1 against `bg`;
- missing `text-body`, `success`, `success-bg` tokens, and `--text-md` below the 12 px floor or redefined outside `:root`;
- CSS `@import`, missing or remote `@font-face` sources (only public-root `/fonts/*.woff2` paths, which Vite rewrites to relative URLs at build; a literal `./fonts/` stays unresolved and 404s from `assets/`), and `@font-face` without `font-display: swap`;
- a missing theme-transition rule and a missing `:root[data-reduce-motion="true"]` rule that zeroes transition and animation durations;
- malformed CSS.

The current startup-theme mutation suite must reject:

- a missing or comment-spoofed bootstrap element, and a bootstrap made deferred, asynchronous, or a module;
- a script or stylesheet inserted before the blocking theme bootstrap;
- a missing or comment-spoofed root-theme assignment, or one moved into an uncalled function, timer, promise callback, or async IIFE;
- a missing, unreachable, or function-decoy preload bridge;
- a missing initial `BrowserWindow` background, an unreachable window construction, or an unreachable `createWindow()` call from the app-ready path.

Non-audit assertions in `tests/ui-design.test.mjs` pin the contract values (D1.1 overrides, D1.3 typography tokens, bundled font files and OFL licenses, D1.4 focus ring, D1.6 transitions). Fonts live in `src/renderer/public/fonts/` (Pretendard Variable, JetBrains Mono 400/500/600) with an `OFL.txt` per family.

The baseline assertions also require symmetric semantic theme tokens, the configured WCAG contrast pairs, one permitted composer fade gradient, explicit disabled states, audited control borders, focus-visible coverage, reduced-motion and forced-colors safeguards, and the compact-header content contract.

## Trust boundary and limitations

These audits assume maintainers are reviewing ordinary project source. They do not attempt to prove behavior for intentionally hostile arbitrary CSS or JavaScript. In particular, they do not claim exhaustive detection of universal `!important` rules, `all` resets, animation or keyframe overrides, deliberately constructed later cascade overwrites outside the modeled selector cases, startup throws, infinite loops, or dead-code decoys beyond the explicit reachability fixtures.

Those threats and runtime failures belong to complementary controls: code review, CSP and security-policy tests, TypeScript and production builds, and Electron/offscreen smoke testing. Do not describe a passing UI audit as a security proof, a complete cascade proof, or proof that the rendered application cannot be subverted by hostile source.
