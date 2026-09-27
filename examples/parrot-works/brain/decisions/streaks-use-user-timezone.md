---
title: "Streak rollover uses the user timezone"
tags: [decision, engineering, streaks]
date: 2026-09-23
decided_by: erik
---
Decided by [[people/erik]] on 23 Sep 2026 after [[people/ada]] found the bug.
Day rollover is computed in the user's IANA timezone, never the server's.
Background: [[lessons/utc13-breaks-streak-rollover]]. Tracked as PARROT-1219. See [[reference/streaks]].
