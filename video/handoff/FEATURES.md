# Throne demo video: what it promises

The hackathon video (v2, about 2:29) makes the promises below. Use this list as the build list.
Every item points to a screenshot in `shots/`, taken straight from the video.

**Status key.** This comes from what the Building session reported as working in the live app on the QM fork.
- **LIVE**: already works in the app.
- **PARTIAL**: exists, but the video shows more than the app does.
- **BUILD**: only in the video so far.

**Real footage.** Only three clips in the video are real recordings: `real/real_proof.mp4` (support proof), `real/real_brain.mp4` (teaching the brain) and `real/real_multiplayer.mp4` (Bill joins). Everything else is a rendered scene.

---

## The pitch in one line
Throne is the front end for QM. Every worker in an isometric office is a real QM session. You sit on a throne, talk to workers before they start, and they come back with proof. They all share one brain, GBrain. It's multiplayer, and it covers every team, not only engineering.

## Features, in the order the video shows them

| # | Feature | What the video shows | Status | Screenshot |
|---|---|---|---|---|
| 1 | The problem | 12 agent terminals asking for input and failing, with no overview. "Seeing the swarm is QM's open problem." | n/a | `01-problem-terminal-chaos.png` |
| 2 | Studio with department areas | An isometric office with colored floor areas and signposts (Marketing, Support, Events, Engineering). Each desk has a team tag, each worker has a name pill and a progress bar, and monitors glow while workers are busy. Top bar: Working, Waiting on you, GBrain pages, QM sessions, and who is in the studio. | PARTIAL: office, desks and name tags are live; colored areas and signposts need building | `02-studio-overview-areas.png` |
| 3 | Throne and the line | You sit on the throne at the top of the red carpet. Workers queue on the carpet with a badge: `!` for ready work, `?` for a question, `✓` for a green PR. A line panel lists them. | LIVE | `03-throne-and-the-line.png` |
| 4 | Talk first, then send away | A new worker walks up and chat opens, marked "Talking · not working yet". A "What we've agreed" card fills in as you talk (Goal, Memory, Length, Proof). The worker cites GBrain: "Recalled from GBrain: Erik's launch emails are short, no emojis." Nothing starts until you press **Send away (⌘↵)**. | PARTIAL: chat and the GBrain recall card are live; the agreement card and "no work until sent away" gating need building (verify) | `04-talk-first-chat-gbrain-recall.png` |
| 5 | Send away | The worker walks to their own desk and starts working, and their progress bar appears. | PARTIAL (verify the walk to a desk after sending away) | `05-send-away-walk-to-desk.png` |
| 6 | GBrain wall | The whole left wall is a live knowledge graph: people, repos, decisions and lessons as colored nodes with labels. Every time a worker recalls something, a glowing beam runs from a node to that worker's monitor, sometimes labeled ("recall · paywall colors"). | PARTIAL: GBrain is real (pedestal plus "B" panel, beams on teach); the wall-sized graph and per-recall beams need building | `06-gbrain-wall-recall-beams.png` |
| 7 | Lessons auto-wire into GBrain | A worker's lesson flies to the wall as a card, becomes a new node, and links itself to related nodes (streaks, UTC+13, Ada, parrot). The GBrain pages counter goes up by one. | PARTIAL: tasks and rules are written to GBrain; the animation and graph view need building | `07-lesson-auto-wired-into-gbrain.png` |
| 8 | Company memory: playbooks | Clicking the brain opens "Company memory", with tabs for Playbooks, Decisions, People and Lessons. Playbooks include How we handle support, How we review PRs, How we ship, and more. Each shows its step count, what it was learned from (for example "212 tickets"), when it was updated, and "Used by N workers". The detail view lists the steps with the source of each one ("decided by Erik · 18 Sep") and the avatars of the workers who use it. The copy says procedures are recorded by Memorable. | BUILD | `08-company-memory-playbooks.png` |
| 9 | Drill in: swarm view | Clicking a worker's monitor opens their computer: plan checklist, live trace (thinking in italics, tool steps), and a "QM swarm of 3 helpers" row (Scout done, Tester working, Checker waiting). Helper bots also stand next to the desk in the room. | BUILD: the peer said not to claim QM swarm helpers yet | `09-drill-in-swarm-helpers-live-trace.png` |
| 10 | Present proof | A worker at the front of the line presents: screenshots, a screen recording, real test output, and stats. Buttons: **Ship it** and Send back. | LIVE (present_work plus the review modal) | `10-present-proof-review.png` |
| 11 | **Real footage** | A live QM support worker (Maya) presents a real customer reply, with sandbox proof: Python zoneinfo output showing New York 23:30 is Tokyo 12:30. Accepted from the throne, no PR needed. | LIVE (recorded) | `11-REAL-live-app-proof.png` |
| 12 | Merge yard | Green PRs from several repos in one list with checkmarks and **Merge 3 into main**. Workers carry gold boxes down the carpet into the "main" vault, and coins burst out. | PARTIAL: PR and merge work for coding desks; the multi-repo yard and carry animation need building | `12-merge-yard.png` |
| 13 | Outcomes | Three linked columns. **Linear**: tickets with assignees, one tagged "112 feedback". **Deploys**: version, environment, PR and time. **User feedback**: clusters with counts and quotes, split by source (App Store, in-app, support), each linked to a ticket and a worker. A "Linked in GBrain" badge. | BUILD | `13-outcomes-linear-deploys-feedback.png` |
| 14 | New area, Finance | A dashed **+ New area** tile gets clicked. The area fills green, a Finance signpost pops up, desks drop in, and two finance workers walk in. | BUILD | `14a-new-area-button.png`, `14b-finance-area-created.png` |
| 15 | Automations | An automations list backed by QM crons, watches and webhooks: monthly close on the 1st at 09:00 → Finance, support digest on Mondays → Support, Stripe payout-failed webhook → Support, nightly flaky-test sweep → Engineering, App Store watch for reviews under 3 stars → Marketing. An automation clock in the room rings, a ticket pops out, a finance worker walks over, grabs it, works, and presents the September close: P&L chart, revenue, margin, burn and runway, "Stripe reconciled with the bank · 0 mismatches", and the P&L sheet attached. | BUILD | `15a-automations-list.png`, `15b-automation-ticket-pickup.png`, `15c-finance-report-proof.png` |
| 16 | Multiplayer: second throne | Bill joins ("Bill Land joined the studio · same QM org · same line · same GBrain"). A second teal throne rises next to Erik's, with name signs over both, and Bill walks in and sits on it. | PARTIAL: Bill joining with presence and his own scope is live; the second throne needs building | `16-multiplayer-second-throne.png` |
| 17 | Hand agents to a teammate | "Erik handed Bjarne, Frances and Dennis to Bill". Those workers' desks get teal rings and a "Now reporting to Bill" bubble, and Bjarne walks from Erik's line to Bill's throne. | BUILD | `17-hand-agents-to-teammate.png` |
| 18 | **Climax**: a teammate's rule spreads | Bill says "New rule: no parrot merges on Fridays". A card flies into the GBrain wall and a pinned node appears, then beams light five engineering desks one by one, each with a "✓ No Friday merges" bubble. A "Pinned to GBrain · 5 desks know it" card counts up. | PARTIAL: "Teach everyone" writes to GBrain with beams to desks; the per-desk sequence and bubbles need building | `18-teammate-rule-pinned-desks-learn.png` |
| 19 | Campus | Zoomed out: one room per team or repo (Parrot engineering, Support, Events, macbridge, one-app, Marketing, Finance) plus a "Cloud annex · QM sandboxes" room of cloud desks. | BUILD: the peer said not to claim cloud desks yet | `19-campus-every-team.png` |
| 20 | Title | "Throne: the front end for QM". Memory by GBrain · Sessions, swarms and multiplayer by QM · Every team, not just code. | n/a | `20-title.png` |

## How it maps to the backend (for the builder)
- **Worker** = QM session. **Boss** = QM principal with its own scope (Erik and Bill each have one).
- **Helpers** = QM swarm workers from `POST /v1/swarm`, shown as bots next to the worker's desk.
- **Areas / rooms** = QM scopes or channels. **Automations** = QM crons, watches and webhooks, with a ticket handed to a worker in that area.
- **Brain** = GBrain: read before every task, written after every task and rule. Playbooks = procedural memory (Memorable-style).
- **Outcomes** = Linear API, deploy history (GitHub/EAS) and the feedback inbox, linked through GBrain pages.

## Visual language
- Isometric office with a warm wood floor, teal walls, red carpet and gold throne. Chunky cream cards with a 3px ink outline and a hard shadow.
- Fredoka for headings, Nunito for UI text, JetBrains Mono for traces.
- Team colors: engineering blue `#4F8DF5`, marketing `#FF7A59`, support `#2BB5A8`, events `#B77CFF`, finance `#2EAD6B`. GBrain is violet and cyan (`#7C5CFF` / `#35E0FF`). Bill is teal `#1F9E97`.
- The full source of every scene is in `../film.html`, which is readable as a spec; search for each panel's function name, such as `playbookPanel`, `outcomesPanel`, `automationsCard` or `financeReport`.
