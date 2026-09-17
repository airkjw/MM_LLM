# Sidebar interaction checks

`npm run ui:check` renders the real React `Sidebar` and shared focus-layer hook in a headless DOM. It does not start Electron and does not claim to measure pixels or native-window painting. CSS token and selector checks remain in `npm run ui:audit`; the production build remains the renderer integration check.

The DOM checks cover the 720px compact boundary, desktop-to-compact and compact-to-desktop open state, modal overlay focus trapping, repeated forward/reverse Tab with an account popover open, account-popover Escape/outside behavior, thread-menu arrow keys, and focus return after commands, scroll, resize, and modal launches. They also verify that compact navigation closes before content actions run and that a launched dialog returns to the original desktop trigger or the visible compact sidebar opener.

`npm test` includes `npm run ui:check`, so the interaction checks are part of the normal release verification path rather than an optional standalone command.

The “settings within two clicks” criterion begins with an already open and visible desktop sidebar: **설정·계정** is click one and **설정** is click two. On a compact window, opening the sidebar is a separate navigation step; it is not hidden from the criterion or described as a two-click route.
