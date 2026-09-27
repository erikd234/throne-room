---
title: "macbridge relay needs reconnect backoff"
tags: [lesson, macbridge, engineering]
learned: 2026-09-26
---
When the relay restarts, every daemon reconnected at once and the relay fell over again.
Fix shipped in macbridge #88: jittered exponential backoff, capped at 30s.
Project: [[projects/macbridge]]. Merged through [[reference/merge-yard]].
