---
title: "Flaky tests hide real bugs"
tags: [lesson, qa, engineering]
learned: 2026-09-23
---
The UTC+13 rollover failure looked flaky because CI runs in UTC and only one fixture used a +13 user.
Rerunning until green would have shipped the bug. Hence [[decisions/flaky-test-rerun-once]].
Example: [[lessons/utc13-breaks-streak-rollover]]. Owner: [[people/ken]].
