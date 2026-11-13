-- Capital calls: pro-rata by unfunded commitment, issued notices, and funding tracked
-- by linking contributions to the call.

create type call_status as enum ('draft', 'issued', 'cancelled');

create table capital_calls (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  fund_id          uuid not null,
  call_number      int not null,
  call_date        date not null,
  due_date         date not null,
  total_amount     numeric(18,2) not null check (total_amount > 0),
  purpose          text not null,
  status           call_status not null default 'draft',
  issued_at        timestamptz,
  issued_by        uuid references auth.users(id),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (fund_id, call_number),
  unique (organization_id, id),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete restrict,
  check (due_date >= call_date)
);

create table capital_call_allocations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  call_id          uuid not null,
  investor_id      uuid not null,
  unfunded_basis   numeric(18,2) not null,       -- investor's unfunded commitment when the call was created
  amount           numeric(18,2) not null check (amount > 0),
  notice_document_id uuid references documents(id) on delete set null,
  notified_at      timestamptz,
  last_reminder_at timestamptz,
  unique (call_id, investor_id),
  foreign key (organization_id, call_id) references capital_calls(organization_id, id) on delete cascade,
  foreign key (organization_id, investor_id) references investors(organization_id, id) on delete restrict
);
create index on capital_call_allocations (investor_id);

alter table capital_transactions add column if not exists capital_call_id uuid references capital_calls(id) on delete restrict;

-- A contribution linked to a call must be from an investor allocated in that call (same fund).
create or replace function check_call_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare c capital_calls;
begin
  if new.capital_call_id is null then return new; end if;
  select * into c from capital_calls where id = new.capital_call_id;
  if c.id is null or c.fund_id <> new.fund_id then raise exception 'That capital call is for a different fund'; end if;
  if c.status <> 'issued' then raise exception 'Record funding only against an issued capital call'; end if;
  if new.kind not in ('contribution', 'reversal') then raise exception 'Only contributions can be linked to a capital call'; end if;
  if not exists (select 1 from capital_call_allocations where call_id = c.id and investor_id = new.investor_id) then
    raise exception 'This investor is not part of that capital call';
  end if;
  return new;
end $$;
create trigger capital_txn_call_link before insert on capital_transactions
  for each row execute function check_call_link();

-- Funding status per allocation (reversals of linked contributions net out).
create view capital_call_status with (security_invoker = true) as
select a.organization_id, a.call_id, a.investor_id, a.amount, a.unfunded_basis, a.notice_document_id, a.notified_at, a.last_reminder_at,
       coalesce(sum(case when t.kind = 'reversal' then -t.amount else t.amount end), 0) as funded,
       a.amount - coalesce(sum(case when t.kind = 'reversal' then -t.amount else t.amount end), 0) as outstanding
  from capital_call_allocations a
  left join capital_transactions t on t.capital_call_id = a.call_id and t.investor_id = a.investor_id
 group by a.id;

-- Draft a call: allocate pro rata by unfunded commitment, cents by largest remainder.
create or replace function create_capital_call(p_fund uuid, p_total numeric, p_call_date date, p_due_date date, p_purpose text)
returns uuid language plpgsql security definer set search_path = public as $$
declare f funds; total_unfunded numeric; cid uuid; num int; cents bigint; assigned bigint;
begin
  select * into f from funds where id = p_fund;
  if f.id is null or not can_post_capital(f.organization_id) then raise exception 'Not allowed'; end if;
  if p_total is null or p_total <= 0 then raise exception 'Enter the amount to call'; end if;
  if coalesce(length(trim(p_purpose)), 0) < 3 then raise exception 'Describe what the capital is for'; end if;
  if p_due_date < p_call_date then raise exception 'Due date must be on or after the call date'; end if;

  create temp table _alloc on commit drop as
    select investor_id, unfunded from capital_accounts
     where fund_id = p_fund and unfunded > 0;
  select coalesce(sum(unfunded), 0) into total_unfunded from _alloc;
  if total_unfunded = 0 then raise exception 'No investor has unfunded commitments in this fund'; end if;
  if p_total > total_unfunded then
    raise exception 'That is more than the total unfunded commitments (%)', to_char(total_unfunded, 'FM$999,999,999,990.00');
  end if;

  select coalesce(max(call_number), 0) + 1 into num from capital_calls where fund_id = p_fund;
  insert into capital_calls (organization_id, fund_id, call_number, call_date, due_date, total_amount, purpose, created_by)
  values (f.organization_id, p_fund, num, p_call_date, p_due_date, round(p_total, 2), left(trim(p_purpose), 1000), auth.uid())
  returning id into cid;

  -- Exact shares in cents, floor, then hand out remaining cents by largest remainder.
  cents := round(p_total * 100);
  create temp table _share on commit drop as
    select investor_id, unfunded,
           (cents * unfunded / total_unfunded) as exact,
           floor(cents * unfunded / total_unfunded)::bigint as base
      from _alloc;
  select sum(base) into assigned from _share;
  insert into capital_call_allocations (organization_id, call_id, investor_id, unfunded_basis, amount)
  select f.organization_id, cid, investor_id, unfunded,
         (base + case when rn <= cents - assigned then 1 else 0 end)::numeric / 100
    from (select *, row_number() over (order by exact - base desc, investor_id) as rn from _share) s
   where base + case when rn <= cents - assigned then 1 else 0 end > 0;
  return cid;
end $$;

create or replace function issue_capital_call(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c capital_calls;
begin
  select * into c from capital_calls where id = p_call;
  if c.id is null or not can_post_capital(c.organization_id) then raise exception 'Not allowed'; end if;
  if c.status <> 'draft' then raise exception 'Only a draft call can be issued'; end if;
  update capital_calls set status = 'issued', issued_at = now(), issued_by = auth.uid() where id = p_call;
end $$;

-- Drafts can be deleted; issued calls can be cancelled only if nothing has been received.
create or replace function cancel_capital_call(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c capital_calls;
begin
  select * into c from capital_calls where id = p_call;
  if c.id is null or not can_post_capital(c.organization_id) then raise exception 'Not allowed'; end if;
  if c.status = 'draft' then delete from capital_calls where id = p_call; return; end if;
  if exists (select 1 from capital_call_status where call_id = p_call and funded <> 0) then
    raise exception 'Funds have been recorded against this call. Reverse them first.';
  end if;
  update capital_calls set status = 'cancelled' where id = p_call;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['create_capital_call(uuid, numeric, date, date, text)', 'issue_capital_call(uuid)', 'cancel_capital_call(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

create trigger audit_capital_calls after insert or update or delete on capital_calls for each row execute function write_audit();

alter table capital_calls enable row level security;
alter table capital_call_allocations enable row level security;
create policy calls_staff_read on capital_calls for select using (is_staff(organization_id));
-- Issued calls the signed-in investor is part of (definer function avoids policy recursion).
create or replace function my_issued_call_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select a.call_id from capital_call_allocations a join capital_calls c on c.id = a.call_id
   where c.status = 'issued' and a.investor_id in (select my_investor_ids())
$$;
create policy calls_lp_read on capital_calls for select using (id in (select my_issued_call_ids()));
create policy alloc_staff_read on capital_call_allocations for select using (is_staff(organization_id));
create policy alloc_lp_read on capital_call_allocations for select using (
  investor_id in (select my_investor_ids()) and call_id in (select my_issued_call_ids()));
-- Only notice/reminder bookkeeping is updated directly, by owner/admin.
create policy alloc_update on capital_call_allocations for update using (can_post_capital(organization_id)) with check (can_post_capital(organization_id));
