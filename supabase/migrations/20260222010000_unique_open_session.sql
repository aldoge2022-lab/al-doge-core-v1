CREATE UNIQUE INDEX IF NOT EXISTS unique_open_session_per_table
ON public.table_sessions(table_id)
WHERE status = 'open';
