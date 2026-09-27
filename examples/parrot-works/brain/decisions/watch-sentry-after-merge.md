---
title: "Watch Sentry for 10 minutes after a parrot merge"
tags: [decision, engineering, incident]
date: 2026-09-14
decided_by: erik
---
Decided by [[people/erik]] on 14 Sep 2026 after an incident where a bad deploy ran 40 minutes unnoticed.
Whoever merges watches Sentry for 10 minutes and reverts on a new top error.
Step in [[playbooks/ship]]; see [[reference/sentry]].
