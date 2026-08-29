---
title: fn-120 publish gate parked for user dogfooding
date: "2026-08-29"
track: knowledge
category: decisions
applies_when: fn-120 publish gate parked for user dogfooding
decision_status: accepted
---

fn-120.7 marketplace submission is intentionally parked: all technical work is done (GPT-5.6 completion review verdict COMPLETE-EXCEPT-MANUAL-GATE at plugin commit ce4d45c), display name confirmed as "GNO Recall" (id gmickel.gno-recall), and the user wants to dogfood the live plugin personally before publishing.

When the user gives the go-ahead:
1. File the omarchyplugins.com GitHub issue form via gh (dossier: /tmp/fn-120.7-qa/SUBMISSION.md — repo https://github.com/gmickel/omarchy-gno-recall, submit pushed HEAD of main, category Productivity, tags Bar/Quickshell/Launcher, five self-certification checkboxes).
2. After listing, run the post-list check: omarchy plugin add <public-url> --enable against released gno >= 1.36.0.
3. Close fn-120.7 with evidence.
