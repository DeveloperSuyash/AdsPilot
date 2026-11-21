# Working on AdsPilot

Read this before changing anything.

## What this is and where it came from

AdsPilot is its own product, at `ads.pilotworks4u.com`, like DevPilot (`dev.`) and SEOPilot (`seo.`). It was first written as a module
inside SEOPilot on 2026-11-21, and moved into this repo the same day on the owner's word: "adspilot separate tool h". That branch in
SEOPilot (`claude/adspilot`) is NOT to be merged.

It is built from SEOPilot's foundation, not from scratch:
- `vault`, `auth`, `ai` + `engines`, `mail`, `smtp` and `cost` are copies, with env vars renamed `SP_` → `AP_`. Keep them in step with
  SEOPilot's when one side fixes something.
- `lib/reconcile.js` is SEOPilot's number checker, unchanged in behaviour.
- The queue and alert rules in `lib/store.js` are SEOPilot's.

An agency using both products must find them behaving alike.

## Before every commit

```bash
npm test           # all of it
npm run typecheck  # the web UI
npm run build      # if you touched web/
```

Tests are plain scripts in `server/test/`, chained in the root `package.json`. A new test file that is not added there never runs. They
need no network: Google Ads is `test/fakegads.mjs`, the model is injected, and `server.test.mjs` boots the real server against a
throwaway directory.

## The words

| Word | Means | In the code |
|---|---|---|
| Workspace | the agency | `org` |
| Client | one Google Ads account the agency runs | `project` (kept, so the Ads code reads the same as in SEOPilot) |
| Account | the Google Ads customer the client points at | the `gads` connection's `config.property` (`cid`, or `mgr:cid` under a manager) |

## Where things are

| | |
|---|---|
| `server/server.js` | sessions, workspaces, members, clients, the Google sign-in, admin, the queue/alerts reads, the timer, the built web app |
| `server/routes/ads.js` | every `/api/projects/:id/ads*` route and `/api/admin/gads`, the 20-hour timer |
| `server/lib/gads.js` | the Google Ads REST client: headers, pagination, errors in words, micros, account listing incl. MCC |
| `server/lib/adssync.js` | the 28-day windows, the GAQL queries, the shape |
| `server/lib/adsanalyze.js` | findings, the metrics envelope, queue rows — pure |
| `server/lib/adsalerts.js` | incidents — pure |
| `server/lib/adschange.js` | proposals (pure) and the ONLY code that writes to an ad account |
| `server/lib/adscopy.js` | Google's ad limits and the line filter |
| `server/lib/adsanalyst.js` | the fact sheet and the rules for questions |
| `server/lib/store.js` | one JSON file, atomic save, one process only |

## The safety model — the rules this product lives or dies by

Every change here spends or stops spending somebody's real money.

1. **Google's `adwords` scope cannot be read-only.** Read-only is our own flag, `config.writesAllowed` on the `gads` connection.
   - It is checked in `adschange.assertWritable`, inside `apply` and `undo`, not in a route. A route added later cannot forget it.
   - It starts OFF. Only an owner or admin can turn it on, and the request must carry an explicit confirm.
   - Choosing a different account, or signing in again, replaces `config`, which turns it off again.
2. **Proposals come from rules, never from the model**, and a person approves each one. The model drafts ad copy and answers questions.
   It never decides or makes a change. There is deliberately no autonomous agent: recovery cannot give back money that was spent the way
   a rollback gives back a page.
3. **Before a write, the current state is read.** The write is refused if the read fails, or if the state moved since the suggestion was
   made. A suggestion from Tuesday must not overwrite a budget somebody changed by hand on Wednesday.
4. **`validateOnly` first**, then the real call.
5. **Read back after.** A write that Google acknowledged but that did not land is journalled as NOT verified, never as done.
6. **Money limits are code:** at most ±30% per budget change, and never above the client's daily ceiling. New ads are created PAUSED.
7. **Undo** replays the inverse and refuses if the entity moved since, because it would overwrite a person's change. Undoing a budget cut
   is exempt from the 30% step, because otherwise undo would be impossible (70 → 100 is +43% after 100 → 70).
8. **Ids are validated** against the expected type AND this customer id before they reach GAQL or a mutate. Keyword text is held to
   Google's characters and limits. There are injection-shaped tests for both.
9. **No install-wide Google grant.** Every client signs in its own Google; `accessTokenFor` has no fallback.

## The rules shared with SEOPilot

- **null is not 0.** A figure Google did not send is "not reported".
- **With nothing to compare against, nothing about change is said.**
- **"Wasted" is judged against the account's OWN cost per conversion**, never a fixed amount. An account recording no conversions is not
  judged for waste at all: the honest finding is the tracking one.
- **The queue's three memory rules**:
  - dismissed stays dismissed;
  - done reopens if the next sync still finds it;
  - open resolves when the finding is gone.

  These are swept per source.
- **Alerts are events.** A resolved alert that comes back is a new incident. Nothing is queued when email is off; the screen says so.
- **Every number from the model is checked against the fact sheet** (`reconcile`), and any that is not there is shown above the answer.
- **The first account runs the install** (Google client, developer token). On a public URL, `AP_SETUP_KEY` must be set, or whoever
  finds the address first owns it.

## NOT verified — the checklist before any client

`developers.google.com` was not reachable from the session that wrote this, so the Google Ads API details are from memory of the reference
and tested only against `test/fakegads.mjs`.

- [ ] **API version.** Default `v22` (`gads.DEFAULT_VERSION`); it is a setting in Admin. Check the current version in Google's release notes.
- [ ] **Developer token.** From the API Center of the platform's manager account. Test access works only on test accounts; apply for Basic access.
- [ ] **Google Cloud.** Enable the Google Ads API in the Cloud project, and add `adwords` to the consent screen (a sensitive scope, so it needs Google's verification).
- [ ] **One sync on a test account.** It checks every GAQL field in `adssync.queries` and the shapes in `adssync.shape`.
- [ ] **One of each write on a test account, and its undo.** Check the `updateMask` names `status` and `amount_micros`.
- [ ] **The manager (MCC) path.** `login-customer-id` and the `customer_client` listing.
- [ ] **Click through the UI with data.**

## Decisions taken without the owner — check them

1. **Thresholds** are constants at the top of `adsanalyze.js`, `adsalerts.js` and `adschange.js`:
   - wasted = 5+ clicks and one conversion's worth of spend;
   - budget-limited = 10%+ lost to budget, 3+ conversions, and no worse than the account;
   - Quality Score ≤ 3;
   - spend spike +50%;
   - cost per conversion +40% on 5+ conversions;
   - budget suggestion +20%, single change capped at ±30%.
2. **Approving suggestions:** once an owner has allowed changes on an account, any member of the workspace can approve suggestions. To
   restrict that to admins, call `requireAdmin` in the apply route.
3. **Store:** a JSON file to start, like SEOPilot did. Move it to Postgres, with SEOPilot's writer lease, before many workspaces use it.
4. **No billing yet:** free during beta. When it is priced, copy SEOPilot's `plans.js` + `cashfree.js`; the reasoning travels with them.
5. **Meta Ads is not built.** Nothing in the UI says otherwise.
6. **The deploy branch is `main`.** DEPLOY.md assumes it.
