# Throne build board

| Tag | Time | Contains | Clips it can produce |
|---|---|---|---|
| stable-3 | 16:36 | stable-2 + P2 talk-first (server, opt-in): hire with talkFirst holds the worker in phase `talking`, planning-only replies, "What we've agreed" card (w.agreed), `sendAway` action starts the real session. No client UI yet; default hire flow unchanged. npm test 27/27. | none yet (no UI) |
| stable-2 | 16:32 | stable-1 + UI QA fixes: brain panel page count and textarea, staggered desk bubbles. npm test 27/27. | same clips |
| stable-1 | 16:22 | P1 GBrain wall + rule climax: wall graph from real GBrain pages/links, node→desk recall beams, lesson cards, taught rule pinned as a node, desks light up one by one with "✓ <rule>", "Pinned to GBrain · N desks know it". Parrot Works example pack. Feature-module hooks. | gbrain_recall, gbrain_teach, gbrain_learn |

## Outcome of in-flight work (freeze 16:30)
- feat/p2-talk-first: no commits by freeze, not landed
- feat/p3-multiplayer: server-side handOff only (4653787), npm test green, no UI, not landed
- feat/p5-areas: no commits; finding: QM projects are real team scopes
- feat/p4-playbooks: stopped (cut: 1–4 not all landed)
- feat/fix-bugs: stopped, not landed

## Cut
Swarm drill-in, merge yard, outcomes, automations, campus.
