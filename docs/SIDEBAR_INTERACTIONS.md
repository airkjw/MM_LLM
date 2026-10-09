# Sidebar interaction checks

`npm run ui:check` renders the real React `Sidebar` and shared focus-layer hook in a headless DOM. It does not start Electron and does not claim to measure pixels or native-window painting. CSS token and selector checks remain in `npm run ui:audit`; the production build remains the renderer integration check.

Since stage 2 of the console redesign the shell has two navigation parts. The **rail** (`nav.rail`, 56px, `aria-label="주 탐색"`) is always visible at every width, including 680–720px windows; it holds the seven destinations (대화, 모델 비교, 논문·법령 리서치, 미디어, 음성, 프로젝트, 챗봇), **앱 설정**, and the **설정·계정** avatar. Only real screens (대화, 미디어) receive `aria-current="page"`; the other destinations still open their existing dialogs until later stages give them screens. The **list column** keeps the `.sidebar` contract: a modal overlay sheet beside the rail at the compact width, and a collapsible column on desktop. Cmd/Ctrl+B collapses only the list column; when focus was inside the list, the rail's expand/open control takes it.

The DOM checks cover the 720px compact boundary, desktop-to-compact and compact-to-desktop open state, modal overlay focus trapping, repeated forward/reverse Tab with an account popover open, account-popover Escape/outside behavior, thread-menu arrow keys, and focus return after commands, scroll, resize, and modal launches. They also verify that compact navigation closes before content actions run and that a launched dialog returns to the original desktop trigger or the visible compact sidebar opener.

They also cover the rail: Tab order (the logo is not focusable), a single `aria-current`, compact rail navigation closing the open sheet before the action runs, list filters as pressed toggle buttons, and the credit card showing `n / m` only with a real quota. Dialog focus returns to the original trigger, else the visible list opener, else the rail's current item.

`npm test` includes `npm run ui:check`, so the interaction checks are part of the normal release verification path rather than an optional standalone command.

The “settings within two clicks” criterion is now one click from any width: **앱 설정** on the rail opens settings directly. The account route still begins with an already open and visible desktop sidebar or any compact window, because the avatar lives on the rail: **설정·계정** is click one and **설정** is click two. Opening the compact list sheet is a separate navigation step and is not part of either route.
