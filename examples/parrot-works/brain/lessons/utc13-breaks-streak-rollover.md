---
title: "UTC+13 breaks streak rollover"
tags: [lesson, streaks, timezones]
learned: 2026-09-23
---
Rollover used the server's day, so users in UTC+13 (Samoa, Tonga, NZ summer) lost a day at midnight UTC.
Found by [[people/ada]]'s Tester helper: TestRollover/UTC and UTC-8 pass, UTC+13 fails. Real bug, not a test bug.
Fix: [[decisions/streaks-use-user-timezone]]. Affects [[reference/streaks]] and [[people/customer-traveler]].
