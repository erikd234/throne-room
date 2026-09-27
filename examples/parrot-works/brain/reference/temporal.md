---
title: "Temporal"
tags: [reference, infra, glossary]
---
Workflow engine behind parrot-cron: streak reminders, digests, email campaigns. Runs on Temporal Cloud since 2 Sep.
Activities retry by default; anything with side effects needs an idempotency key.
See [[decisions/move-to-temporal-cloud]] and [[lessons/temporal-retries-double-send-emails]]. Owner: [[people/barbara]].
