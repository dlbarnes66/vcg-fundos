# VCG FundOS

Internal fund-management platform for Venture Collective Group, built multi-tenant from day one so it can become a SaaS later.

**Stack:** Next.js 15 (App Router, server actions) · Supabase (Postgres, Auth, Storage) · TypeScript. No client-side data access: every query runs on the server with the signed-in user's session, and the database enforces access with row-level security.

## What's in v1

| Area | What it does |
|---|---|
| **Dashboard** | Committed vs. $10M target, pipeline value, contributed/unfunded, distributions, follow-ups due, 506(c) accreditation gaps, fund terms |
| **Investor pipeline** | Kanban from qualified → funded (earlier stages live in CRM OS), search, add investors, target amounts, follow-up dates |
| **Investor detail** | Profile, stage, accreditation (status, verified/expiry dates), activity log, commitments, capital activity, pref estimate, portal access |
| **Capital activity** | Capital accounts per investor, post contributions/distributions/returns of capital/fees, reversals with a required reason |
| **Data room** | Private uploads with three visibility levels (internal / all investors / one investor), signed 60-second links, open counts |
| **Investor portal** | LPs see only their commitment, capital activity and shared documents |

### Guardrails built into the database (not just the UI)

- **Tenant isolation.** Every table has `organization_id`, row-level security, and composite foreign keys so records can't be linked across organizations.
- **Append-only money.** `capital_transactions` can't be updated or deleted, even by an admin in the SQL editor. Mistakes get a reversal row that must match the original, and a transaction can only be reversed once.
- **506(c).** A commitment can't be marked *accepted* unless the investor's accreditation is verified and unexpired.
- **Contributions can't exceed the accepted commitment** (checked in the app).
- **Roles.** Owner, Admin, Investor Relations, Viewer, Investor. Only Owner/Admin can post capital, accept commitments, delete files or grant portal access.
- **Audit log.** Inserts, updates and deletes on investors, commitments, capital, documents and funds are recorded in `audit_events` with before/after values.
- **Money is `numeric(18,2)`** end to end; amounts go into the database as strings, never floats.

## Setup (about 15 minutes)

1. **Create a new Supabase project** for this app. Don't reuse the vcgnow portal project; keep investor financial data separate.
2. **Run the schema.** Supabase → SQL Editor → run each file in `supabase/migrations/` in order (`0001_init.sql`, `0002_crm_handoff.sql`, `0003_team_and_funds.sql`, `0004_document_studio.sql`, `0005_investor_onboarding.sql`, `0006_mfa_notify_cleanup.sql`). Then run `supabase/seed.sql` (this only defines the demo function).
3. **Create your login.** Authentication → Users → Add user (email + password, auto-confirm).
4. **Make yourself owner.** In the SQL editor:
   ```sql
   select bootstrap_owner('dlbarnes@vcgnow.com');
   select seed_demo('vcg');   -- optional: Fund I + 5 synthetic investors
   ```
5. **Configure the app.**
   ```bash
   cp .env.example .env.local     # paste your project URL and anon key
   npm install
   npm run dev                    # http://localhost:3000
   ```
6. **Turn off public sign-ups.** Authentication → Providers → Email → disable "Allow new users to sign up". Access is invite-only.

### Adding people

Invites need `SUPABASE_SERVICE_ROLE_KEY` in Vercel (type **Secret**). Email delivery is optional: with `RESEND_API_KEY` and `MAIL_FROM` set, invites are emailed; without them, FundOS shows a one-time link for you to send.

- **Team member:** **Team** → enter their email and a role → **Send invite**. Owners can grant any role; admins can add Investor relations or Viewer.
- **Investor (LP):** open their investor record → **Investor portal access** → **Invite to portal**.
- They open the link, set a password, and they're in. Links work once and expire in about an hour; use **Send sign-in link** for a fresh one (also how someone resets a forgotten password).

### Fund setup

**Funds** → **New fund**, or open a fund to edit its terms. Rates are entered as percentages (7 = 7%). Every change is recorded in the audit log.

### Before real investor data goes in

- Fill in the GP catch-up and carry split on the fund's page (**Funds** → your fund) from the PPM. They are blank on purpose.
- Delete the demo data, or start a fresh project.
- Turn on MFA for staff accounts (Supabase Auth → MFA) and use a strong password policy.
- Upgrade the Supabase project to a paid plan for daily backups and point-in-time recovery.
- Keep the fund's official books with your CPA or fund administrator. This app is the investor-level record that reconciles to them, not a replacement.

## CRM OS handoff

CRM OS (crm.vcgnow.com) owns marketing: lead capture, campaigns, nurture. FundOS owns everything from **Qualified** onward. There's one pipeline per stage of the journey, with no double tracking.

1. In FundOS go to **Settings → Create API key**. Copy the key, which is shown once.
2. In CRM OS's Vercel project, add the environment variables `FUNDOS_API_KEY` (the key) and `FUNDOS_URL` (your FundOS domain).
3. When a contact in CRM OS's Fund workspace is marked qualified, CRM OS calls:

```bash
curl -X POST "$FUNDOS_URL/api/intake" \
  -H "Authorization: Bearer $FUNDOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Smith","email":"jane@example.com","external_id":"crm-contact-123","target_amount":100000,"note":"Asked for the PPM"}'
```

- New contact → investor created at **Qualified**, returns `201`.
- Same contact sent again (matched by `external_id`, then email) → no duplicate, stage untouched, returns `200`.
- Each handoff is logged on the investor's activity timeline.
- Only a SHA-256 hash of the key is stored. Revoke a key in Settings and calls with it fail immediately.

## Security and notifications

- **Two-factor sign-in:** everyone can turn it on under **Sign-in security** (sidebar) with any authenticator app. Owners can then require it for all staff (**Settings**). When required, posting money, approving subscriptions and changing wire instructions are refused by the database on a password-only session. Lost phone: an owner uses **Team → Reset two-factor**. If the *owner* loses their phone, remove the factor in Supabase → Authentication → Users → the user → MFA.
- **Email notifications** (needs `RESEND_API_KEY` and `MAIL_FROM`): owners and admins are emailed when an investor submits a subscription; investors are emailed when they're approved, sent back or declined, and when you upload a document just for them (tick "Email the investor"). Without Resend, nothing is sent and nothing breaks.
- **Clear sample data:** **Settings → Clear sample data** (owner, typed confirmation) removes the @example.com demo investors and everything attached. Do this before real investors are added.

## Investor onboarding

Investors subscribe in their portal in five steps: **investor information**, **W-9 upload**, **read the offering documents**, **accreditation verification letter**, and **e-signature**. Then you review and approve.

**Set up once per fund** (Funds → your fund → *Investor onboarding*):
1. Upload the offering documents (PPM, LPA, fact sheet) to the Data room with category **Offering** and visibility **All investors**.
2. Upload the subscription agreement as a PDF shared with **All investors**, then choose it as the fund's subscription agreement.
3. Owner only: enter the **wire instructions** and a phone number investors call to confirm them. Investors see these only after you accept their commitment.

**Per investor:** invite them to the portal from their record. A subscription opens automatically for each fund that is *Raising*. You can also open one with **Open subscription**. When they submit, it appears in **Subscriptions** as *Ready for review*. **Approve** marks accreditation verified (with an expiry date), creates the accepted commitment, and moves them to Committed. **Send back** asks for changes, and they re-sign.

**E-signature** is built in (no DocuSign fee): consent, typed signature, account, time, IP and device, plus a SHA-256 fingerprint of the exact PDF signed, all on a certificate page attached to the signed copy. Have fund counsel confirm they're comfortable with click-to-sign for your subscription agreement.

**Privacy:** SSNs and EINs are never typed into FundOS. They're on the uploaded W-9, stored in the investor's private folder.

## Document Studio

AI-assisted **drafts** of fund documents for counsel review: PPM, LPA, subscription agreement, investor questionnaire, capital call notice and side letter. Plus a **consistency checker** for documents you already have.

- **Drafting** uses only the fund's recorded terms and legal profile (**Funds → your fund**). Anything not recorded becomes a highlighted `[[MISSING: …]]` item; judgment calls become `[[COUNSEL: …]]`. It never fills in "market standard" economics.
- Drafts are versioned. **Mark as sent to counsel**, then **Download Word** to send. Only an owner can **record counsel approval**, and only when no section is empty and no item is open. Approved versions are locked, and changes go into a new version.
- **Consistency checker:** upload the PPM and LPA to the Data room as PDFs, tick them in Studio, and run. It compares them with the fund record and with each other (rates, fees, waterfall, minimums, entities, exemption, transfers) and lists conflicts for counsel. It can miss things; it is not a sign-off.
- Investors never see drafts.

Requires `ANTHROPIC_API_KEY` in Vercel (type **Secret**). Optional: `ANTHROPIC_MODEL` (defaults to the newest available Sonnet).

## Tests

```bash
npm test
```
Runs the pref-return and money unit tests, plus 97 database security tests against an in-memory Postgres: tenant isolation, LP visibility, storage access, append-only capital, reversals, the 506(c) acceptance rule, portal-linking permissions and the CRM OS handoff (keys, dedupe, revocation), team roles and fund-term permissions.

## Deploying

Vercel is the simplest option: import the repo, add the two `NEXT_PUBLIC_SUPABASE_*` env vars, deploy. A subdomain such as `funds.vcgnow.com` fits your existing setup.

## Roadmap (next modules)

1. **Distribution waterfall.** Return of capital → 7% pref → catch-up → carry split, computed from `funds.terms`, previewed per investor, approved by a second person before posting.
2. **Capital calls.** A pro-rata call builder with notices and due dates.
3. **Subscription onboarding.** E-signature (DocuSign/Dropbox Sign) and an accreditation-verification provider.
4. **Deals and assets.** Properties, units, HUD-VASH occupancy, rent roll, valuations.
5. **Quarterly reporting.** PDF statements generated from posted data.
6. **SaaS layer.** Org sign-up, Stripe billing, per-org branding. The schema is already multi-tenant.

`lib/pref.ts` gives a simple-accrual *estimate* only. The governing calculation is whatever the PPM says, verified by your accountant.
