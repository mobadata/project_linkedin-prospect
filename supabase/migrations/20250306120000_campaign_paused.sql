-- État pause pour les campagnes en arrière-plan
create table if not exists public.campaign_paused (
  user_id uuid primary key references auth.users(id) on delete cascade,
  paused boolean not null default false,
  updated_at timestamptz default now()
);

alter table public.campaign_paused enable row level security;

create policy "Users can manage own pause"
  on public.campaign_paused for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
