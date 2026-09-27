---
title: "Temporal retries double-send emails"
tags: [lesson, temporal, email]
learned: 2026-09-24
---
parrot-cron sends email from inside an activity. When the activity times out after the send, [[reference/temporal]] retries it and the learner gets two.
Fix: idempotency key per (user, campaign, day) checked before send.
Found after 3 workers searched GBrain for the retry policy and found 0 pages. Affects [[playbooks/write-launch-emails]].
Owner: [[people/barbara]].
