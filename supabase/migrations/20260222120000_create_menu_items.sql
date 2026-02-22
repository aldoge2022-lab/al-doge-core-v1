create extension if not exists pgcrypto;

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null,
  prezzo numeric(10,2) not null,
  ingredienti jsonb default '[]'::jsonb,
  allergeni jsonb default '[]'::jsonb,
  tag jsonb default '[]'::jsonb,
  varianti jsonb default '{}'::jsonb,
  promozioni jsonb default '{}'::jsonb,
  disponibile boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
