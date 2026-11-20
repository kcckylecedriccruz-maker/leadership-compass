# Leadership Compass – 1-page PRD

**Product:** Leadership Compass (live: https://leadership-compass-formidea.netlify.app)
**Owner:** _[your name]_ · **Status:** v1.1 live · **Full PRD:** shared document "Leadership Compass — Product Requirements"

## Problem
HR teams in small and mid-sized Philippine organisations run leadership 360 reviews with spreadsheets, forms and email.
Choosing who rates whom is manual, raters often don't understand the items or write vague comments, anonymity is easy
to break, and turning dozens of comments into a development plan takes days.

## Target user
Primary: the HR or L&D administrator who runs the review. Secondary: employees who give and receive feedback, and
managers who coach their team.

## Goals (v1)
1. Set up a review in under an hour from an Excel list or the org chart.
2. Every rater understands each item and writes a specific, observable example.
3. Each person gets an anonymous, actionable report and a 30/60/90-day plan.

## Solution
- Org structure decides evaluations (self, manager, skip-level, upward, peers, external) per cycle.
- Guided form with AI help: plain-English/Filipino explanations, behaviour suggestions, note coach, rating suggestion.
- Reports with anonymity rules; AI feedback summaries, cycle insights and an insight generator for admins; team insights for managers.
- Works for people without accounts through secure links; external raters and outside people.

## AI capability
Google Gemini (free tier; Claude optional) through one server function, with names removed before sending and
structured JSON output. Features: feedback summary + development plan, cycle insights with themes from written
feedback, ask/compare/trend insights, team insights, item help, behaviour suggestions, rating suggestion, note coach.

## Success metrics
- ≥90% of evaluations submitted before the cycle closes.
- ≥80% of behaviour notes judged "specific" by the note coach on first check.
- Admin time to produce development plans reduced from days to minutes.

## Out of scope (v1)
Payments, performance ratings for pay decisions, integrations with HRIS, mobile apps.

## Risks
AI mistakes (mitigated: labelled outputs, human review), free-tier data use by Google (mitigated: name removal,
disclosure), anonymity in small groups (mitigated: minimum group size).
