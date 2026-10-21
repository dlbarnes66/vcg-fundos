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
2. **Run the schema.** Supabase → SQL Editor → run each file in `supabase/migrations/` in order (`0001_init.sql`, then `0002_crm_handoff.sql`). Then run `supabase/seed.sql` (this only defines the demo function).
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

- **Team member:** invite them in Supabase Auth, then in SQL:
  `insert into memberships (organization_id, user_id, role) select o.id, u.id, 'investor_relations' from organizations o, auth.users u where o.slug='vcg' and u.email='them@example.com';`
- **Investor (LP):** invite them in Supabase Auth, then open their record in the app → *Investor portal access* → enter their email.

### Before real investor data goes in

- Fill in `gp_catch_up` and `carry_split` in the fund's `terms` from the PPM. They are blank on purpose.
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

## Tests

```bash
npm test
```
Runs the pref-return and money unit tests, plus 35 database security tests against an in-memory Postgres: tenant isolation, LP visibility, storage access, append-only capital, reversals, the 506(c) acceptance rule, portal-linking permissions and the CRM OS handoff (keys, dedupe, revocation).

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
