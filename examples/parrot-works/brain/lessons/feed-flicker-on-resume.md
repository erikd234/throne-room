---
title: "Feed flickers on resume"
tags: [lesson, feed, engineering]
learned: 2026-09-21
---
Returning to the app shows a black flash before the video. 112 reports: App Store 41, in-app 58, support 13.
Cause: the pooled video surface is released on background and recreated on resume.
Tracked as PARROT-975, [[people/linus]] is on it. Cluster from [[reference/feedback-inbox]]; part of [[projects/parrot]].
