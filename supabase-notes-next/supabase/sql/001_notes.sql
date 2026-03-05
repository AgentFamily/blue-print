-- Create the table
create table if not exists public.notes (
  id bigint primary key generated always as identity,
  title text not null
);

-- Insert sample data
insert into public.notes (title)
values
  ('Today I created a Supabase project.'),
  ('I added some data and queried it from Next.js.'),
  ('It was awesome!');

-- Enable RLS
alter table public.notes enable row level security;

-- Public read policy
drop policy if exists "public can read notes" on public.notes;
create policy "public can read notes"
on public.notes
for select to anon
using (true);
