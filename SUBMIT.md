# Throne: submission

**Ship tag: `stable-1`** (`~/dev/throne-room`, commit `fab9a54`). This is the front end for QM: every worker is a real QM session, and the whole studio shares one GBrain.

## Run it (one command, QM must be up)

```bash
cd ~/dev/throne-room && THRONE_HOME=$(mktemp -d) PORT=4777 npm start
```

- Open http://localhost:4777. Add `?as=bill` in a second window for the teammate.
- A fresh `THRONE_HOME` loads the Parrot Works example pack into its own GBrain in about 2s (83 pages, 281 links).
- QM needs to be running first: `cd ~/dev/qm && npm run dev-instance:web` (core :8081, admin :8129/admin).
- `npm run reset:brain` wipes the default studio brain and reloads the pack.

## Verified on stable-1 (16:22–16:24)

- **Fake e2e:** `npm test` passed 27/27 (hire, chat, uploads, slash skills, present/review, PR/merge, teach, services, workspace picking).
- **Live QM pass** on a fresh boot:
  - 5 real QM workers were hired from the pack's demo tasks: support replies, a support digest, launch emails, a launch tweet.
  - Each one recalled 9–10 GBrain pages, worked in its QM sandbox, presented, and wrote its lesson back to GBrain. The page count went 83 → 91.
  - A rule taught as Bill reached 7 desks.

## Live vs. video only

| Video feature | Status |
|---|---|
| GBrain wall: live graph of real pages and links (06) | **LIVE** |
| Beam from node to desk on every real recall, labeled "recall · <page>" (06) | **LIVE** |
| Lessons fly to the wall as a new node, auto-linked to related pages; GBrain pages counter (07) | **LIVE** |
| Rule climax (18): the taught rule pins as a node, desks light up one by one with "✓ <rule>" bubbles, "Pinned to GBrain · N desks know it" card | **LIVE** |
| Throne and the line, present proof, review, ship/merge, QM support proof (03, 10, 11) | LIVE (from before) |
| Bill joins: presence, his own QM scope (16) | LIVE (from before). The second throne and signs are **video only** |
| Talk first → Send away, "What we've agreed" card (04, 05) | video only |
| Hand agents to Bill (17) | video only. The server-side `handOff` is on branch `feat/p3-multiplayer`, not landed and with no UI |
| Department areas, "+ New area" (02, 14) | video only. QM projects work as real team scopes (`POST /v1/projects`), not wired yet |
| Playbooks tab, swarm drill-in, merge yard, outcomes, automations, campus (08, 09, 12, 13, 15, 19) | video only (cut) |

## Clips (1920×1080, from stable-1 on a fresh boot)

- `video/real/gbrain_recall.mp4` (9.6s): a real QM hire, with beams from "UTC+13 breaks streak rollover" and "Streaks" to the desk.
- `video/real/gbrain_learn.mp4` (12s): a real QM worker presents, and the lesson flies onto the wall.
- `video/real/gbrain_teach.mp4` (11.3s): Bill teaches "No parrot merges on Fridays". It pins to GBrain, 7 desks light up with ✓ bubbles, and the card counts up.
- Earlier real clips are still valid: `real_proof.mp4`, `real_brain.mp4`, `real_multiplayer.mp4`, `real_hire.mp4`.

## Known issues

- Real Claude/Codex e2e:
  - The Codex `git push` block now re-prepends the shims in login zsh through a Throne ZDOTDIR. I verified that with a login shell, but not yet in a full real Codex run.
  - Services that Codex starts don't show up in the services catalog.
  - A Claude worker in the `done` phase doesn't answer a `/skill` chat.
- Every `recall` also includes all standing rules. The beams take pages first and show up to 3.
- The wall labels are dense with 80+ nodes. Only 16 are labeled, chosen by collision.
- `~/.throne-room/gbrain-old-*` holds an earlier seed built from Erik's personal agent memory notes. It isn't used; delete it if you don't want it on disk.
