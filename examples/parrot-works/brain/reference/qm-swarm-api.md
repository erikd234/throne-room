---
title: "QM swarm API"
tags: [reference, qm, glossary]
---
POST /v1/swarm starts helper workers under a QM session. Body: {parent, helpers: [{name, kind, model, task}]}.
Typical swarm: Scout (Explore, Haiku), Tester (worker, Opus), Checker (reviewer, Sonnet, waits for Tester).
Helpers stand next to the parent's desk in [[projects/throne]]. Runtime: [[projects/qm]]. Example user: [[people/ada]].
