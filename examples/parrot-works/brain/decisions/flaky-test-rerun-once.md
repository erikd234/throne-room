---
title: "Flaky tests: rerun once, then file it"
tags: [decision, engineering, qa]
date: 2026-09-19
decided_by: erik
---
Proposed by [[people/ken]], decided by [[people/erik]] on 19 Sep 2026.
Rerun a failing test once. If it passes, file a Linear ticket before merging. Never rerun twice.
Step in [[playbooks/review-prs]]. Why: [[lessons/flaky-tests-hide-real-bugs]].
