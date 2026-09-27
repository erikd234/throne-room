---
title: "How we handle Stripe payout failures"
tags: [playbook, support, finance]
steps:
  - text: "Webhook opens a Support ticket with the payout ID"
    source: "decided by Bill · 5 Sep"
    date: 2026-09-05
  - text: "Ask for updated bank details in the first reply"
    source: "learned from 31 webhooks"
    date: 2026-09-20
  - text: "Never retry the payout before details change"
    source: "from Sam · 20 Sep"
    date: 2026-09-20
  - text: "Tell Finance so the close shows it as pending"
    source: "from Penny · 1 Sep"
    date: 2026-09-01
learned_from: "31 webhooks"
updated: 2026-09-20
---
Owned by [[people/sam]]. Cause: [[lessons/payout-failed-means-bank-details]].
Finance side: [[playbooks/close-the-month]]. Webhook: [[reference/automations]].
Median time from webhook to first reply: 22 minutes.
