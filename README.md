# AdsPilot

Google Ads for agencies — a PilotWorks4u product, at **ads.pilotworks4u.com**, beside DevPilot (dev.) and SEOPilot (seo.).

Connect a client's Google Ads account. AdsPilot reads it every day and tells you three things:
- what is wasting money (search terms with no conversions, low Quality Score keywords, Poor ads),
- what is held back (campaigns losing impressions to budget while converting well),
- what broke (conversion tracking, disapproved ads).

It suggests changes, and each change runs only after a person approves it:
- negative keywords;
- pausing a keyword;
- a budget step;
- a new ad, created paused.

Every change is checked against Google after it is made and can be undone. Ad copy is drafted by AI and held to Google's limits and your
own business facts. Questions about an account are answered from its data, with any figure that is not in the data named.

```bash
npm run setup && npm run build && npm start     # http://localhost:4020/app
npm test                                         # no network, no Google account, no model
```

`CLAUDE.md` is how work on this goes and what is not verified yet. `DEPLOY.md` is how it goes live.
