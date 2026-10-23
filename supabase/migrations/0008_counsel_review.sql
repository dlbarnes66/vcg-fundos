-- Outside counsel access to Document Studio, with comments and counsel sign-off.
-- Counsel sees: fund terms, drafts, consistency checks, and offering/subscription documents
-- that aren't investor-specific. Counsel never sees investors, commitments or capital.

create or replace function is_counsel(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(org)::text = 'counsel', false)
$$;

create policy funds_counsel_read on funds for select using (is_counsel(organization_id));
create policy drafts_counsel_read on doc_drafts for select using (is_counsel(organization_id));
create policy sections_counsel_read on doc_sections for select using (is_counsel(organization_id));
create policy checks_counsel_read on doc_checks for select using (is_counsel(organization_id));
create policy documents_counsel_read on documents for select using (
  is_counsel(organization_id) and visibility <> 'investor' and category in ('offering', 'subscription'));

-- Comments on draft sections, by staff or counsel.
create table doc_comments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  draft_id         uuid not null,
  section_id       uuid references doc_sections(id) on delete cascade,
  author_id        uuid not null references auth.users(id),
  author_email     text,
  body             text not null check (length(body) between 1 and 4000),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, draft_id) references doc_drafts(organization_id, id) on delete cascade
);
create index on doc_comments (draft_id, created_at);
alter table doc_comments enable row level security;
create policy comments_read on doc_comments for select using (is_staff(organization_id) or is_counsel(organization_id));
create policy comments_insert on doc_comments for insert with check (
  (can_write(organization_id) or is_counsel(organization_id)) and author_id = auth.uid());
create policy comments_resolve on doc_comments for update
  using (can_write(organization_id) or is_counsel(organization_id))
  with check (can_write(organization_id) or is_counsel(organization_id));
create trigger audit_doc_comments after insert or update on doc_comments for each row execute function write_audit();

-- Comment authors' email is filled in from their login (can't be spoofed).
create or replace function set_comment_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_email := (select email from auth.users where id = new.author_id);
  return new;
end $$;
create trigger doc_comments_author before insert on doc_comments for each row execute function set_comment_author();

-- Owners or counsel may record approval (owner records counsel's name; counsel approves under their own login).
create or replace function guard_draft_approval() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and not (coalesce(member_role_in(new.organization_id) = 'owner', false) or is_counsel(new.organization_id)) then
    raise exception 'Only an owner or the fund''s counsel can record approval';
  end if;
  return new;
end $$;

-- Counsel sign-off. Blocked while any section is empty or has an open [[MISSING]]/[[COUNSEL]] marker.
create or replace function counsel_approve(p_draft uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare d doc_drafts; who text; open_items int; empties int;
begin
  select * into d from doc_drafts where id = p_draft;
  if d.id is null or not is_counsel(d.organization_id) then raise exception 'Not allowed'; end if;
  if d.status not in ('draft', 'in_review') then raise exception 'This version is % and cannot be approved', d.status; end if;
  select count(*) filter (where content is null or btrim(content) = ''),
         count(*) filter (where content ~ '\[\[(MISSING|COUNSEL):')
    into empties, open_items from doc_sections where draft_id = p_draft;
  if empties > 0 then raise exception '% section(s) are still empty', empties; end if;
  if open_items > 0 then raise exception '% section(s) still have open Missing/Counsel items', open_items; end if;
  select email into who from auth.users where id = auth.uid();
  update doc_drafts set status = 'approved', approved_by_name = 'Counsel: ' || who, approved_at = now(),
         approval_note = left(p_note, 2000)
   where id = p_draft;
end $$;
revoke execute on function counsel_approve(uuid, text) from public, anon;
grant execute on function counsel_approve(uuid, text) to authenticated;

-- Counsel can be invited from the Team page by an owner or admin.
-- (add_staff_member already accepts any non-investor role; admins may grant counsel.)
