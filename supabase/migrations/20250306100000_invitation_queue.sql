-- File d'attente pour campagnes d'invitations en arrière-plan
create table if not exists public.invitation_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  prospect_id uuid references public.prospects(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

alter table public.invitation_queue enable row level security;

create policy "Users can view own queue"
  on public.invitation_queue for select
  using (auth.uid() = user_id);

create policy "Users can insert own queue"
  on public.invitation_queue for insert
  with check (auth.uid() = user_id);

create index invitation_queue_user_status_idx on public.invitation_queue(user_id, status);
create index invitation_queue_pending_idx on public.invitation_queue(created_at) where status = 'pending';
