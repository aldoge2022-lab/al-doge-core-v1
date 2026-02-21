create extension if not exists pgcrypto;

create table if not exists public.restaurant_tables (
  id text primary key,
  status text not null default 'open',
  total_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.table_orders (
  id uuid primary key default gen_random_uuid(),
  table_id text not null references public.restaurant_tables(id) on delete cascade,
  total_cents integer not null,
  paid boolean not null default false,
  status text not null default 'pending',
  stripe_session_id text,
  created_at timestamptz not null default now()
);

alter table public.restaurant_tables
  add column if not exists status text not null default 'open',
  add column if not exists total_cents integer not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table public.table_orders
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists table_id text,
  add column if not exists total_cents integer not null default 0,
  add column if not exists paid boolean not null default false,
  add column if not exists status text not null default 'pending',
  add column if not exists stripe_session_id text,
  add column if not exists created_at timestamptz not null default now();

alter table public.table_orders alter column id set default gen_random_uuid();
alter table public.table_orders alter column table_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.table_orders'::regclass
      and contype = 'p'
  ) then
    alter table public.table_orders
      add constraint table_orders_pkey primary key (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'table_orders_table_id_fkey'
  ) then
    alter table public.table_orders
      add constraint table_orders_table_id_fkey
      foreign key (table_id) references public.restaurant_tables(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurant_tables_status_check'
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_status_check
      check (status in ('open', 'closed'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'table_orders_status_check'
  ) then
    alter table public.table_orders
      add constraint table_orders_status_check
      check (status in ('pending', 'paid'));
  end if;
end $$;

create index if not exists idx_table_orders_table_id on public.table_orders(table_id);

create or replace function public.increment_table_total(table_id_input text, amount_input integer)
returns void
language plpgsql
as $$
begin
  if amount_input < 0 then
    raise exception 'amount_input must be >= 0';
  end if;

  update public.restaurant_tables
  set total_cents = coalesce(total_cents, 0) + amount_input,
      status = 'open'
  where id = table_id_input;

  if not found then
    insert into public.restaurant_tables (id, status, total_cents)
    values (table_id_input, 'open', amount_input)
    on conflict (id) do update
    set total_cents = coalesce(public.restaurant_tables.total_cents, 0) + excluded.total_cents,
        status = 'open';
  end if;
end;
$$;
