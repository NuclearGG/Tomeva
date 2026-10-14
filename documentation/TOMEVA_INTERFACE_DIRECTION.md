# Tomeva workspaces

## Audit and intent

The current workspaces repeat large pastel tiles, decorative emoji, Fraunces headings and heavy rounded cards. A long dark navigation column competes with the work. Admin repeats collection distribution in two charts; desk actions have equal weight despite issue/return being the daily priority. Forms, identifiers and connection states need one consistent visual vocabulary.

Preserve the existing logo, institution identity, navigation labels, route IDs, form order and data contracts. Retain the security, backup, local-calendar and keyboard fixes already present. No real institution data is needed for visual QA.

## Product world

- Domain: circulation slips, accession numbers, borrower cards, due dates, shelf labels, catalogue indexes, lending queues.
- Color world: indigo ink, white catalogue stock, soft grey shelf labels, the existing gold book mark, green cleared stamps, amber due notices, red exception marks.
- Signature: a circulation slip with a narrow ink-colored edge, compact identifier typography and explicit reader / copy / loan context. Repeat this in desk actions, form guidance, status summaries, records and access panels.
- Reject: rainbow statistic cards in favor of a neutral ledger; oversized emoji in favor of one Phosphor icon family; duplicate overview charts in favor of collection state and actionable exceptions.

## Shared foundations

Intent: a librarian at a busy desk and an administrator reviewing their institution should scan confidently, act quickly and understand whether information is local or synced.

Palette: existing logo indigo is the action/selection accent. White and lightly tinted catalogue surfaces share one temperature. Gold belongs to the existing mark. Green/amber/red communicate actual states rather than decorate different pages.

Depth and surfaces: borders and small tonal changes, no raised rainbow cards. Catalogue canvas, paper panel and inset control surfaces. Popovers and dialogs alone need a restrained elevation shadow.

Typography: locally hosted Manrope for readable controls and headings; IBM Plex Mono for accession/admission numbers and slip metadata. 12 / 14 / 16 / 20 / 28 / 40 px hierarchy. Use weight, color and space together; tabular figures for changing counts.

Spacing: 4 px unit. Controls at least 40 px high; nav rows 40 px; 16–24 px panel padding; 24 px between work areas. 224 px navigation serves the work instead of dominating it. Corners: 6 px controls, 10 px panels, 14 px dialogs.

## Component checkpoints

| Component | Intent and focal point | Hierarchy, depth and spacing |
| --- | --- | --- |
| Workspace shell | Know the institution, role and current location | Existing mark plus compact role; same-tone sidebar; ink selection tab; 40 px navigation rows |
| Librarian dashboard | Start the next issue or return | Circulation slip as the main work area, issue as primary and return as secondary; compact ledger metrics; overdue and recent activity beneath |
| Issue / return | Check the borrower and accession number before committing | Largest emphasis on the form and its native action; supporting instructions become a quiet indexed slip; inset fields and visible previews |
| Admin overview | Understand the collection and address exceptions | A collection total plus compact ledger numbers; non-overlapping collection states; overdue and fines form the attention queue |
| Tables and filters | Read identifiers, filter records and locate an action | Mono identifiers, quiet headers, consistent row rhythm, contained horizontal scroll and explicit empty/error states |
| Forms and dialogs | Complete an edit without losing place | Existing field order and native controls; visible focus; bounded height; preserved keyboard handling; no decorative animation |
| Control Center | Prepare a complete institution handoff | A setup folio with project settings, rules and packages in task order; the current project state is secondary; recovery remains a distinct safety action |
| Student Portal | Find the next book and understand whether it can be borrowed | Search leads; catalogue entries resemble accession slips with identifiers, title, author, availability and request action; the same light materials continue through sign-in and request states |

## Verification contract

Render the actual source with synthetic records at normal and small laptop sizes. Inspect overview, issue, return, students, catalogue, requests, settings, admin access and setup. Check missing assets, horizontal overflow, focus, dialogs, real circulation and bridge operations. Keep all fonts/icons available without network access.

## Completed verification — 14 October 2026

- 85 application tests passed.
- Librarian, Admin and Control Center desktop smoke tests passed, including circulation, sandboxed preload, institution setup, recovery and package/web exports.
- Admin and Student bundles compiled successfully; Control Center renderer built successfully.
- 60 source-rendered views checked across all four applications at desktop, laptop and narrow widths; Student Portal also checked at 390 px. Local fonts loaded and document overflow checks passed. A further 15 Student views passed after visual refinements.
- Preview data is synthetic. Screenshots are generated under `Control Center/test-artifacts/workspace-design/` with `npm run review:interface`.
- The verified interface and appearance changes are included in the v1.0.9 release; see the release notes and live appearance rollout guide.
