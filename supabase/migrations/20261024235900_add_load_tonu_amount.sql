ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS tonu_amount numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.loads.tonu_amount IS 'Optional TONU amount paid when the load is cancelled.';

NOTIFY pgrst, 'reload schema';
