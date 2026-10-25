ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS cut numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.loads.cut IS 'Company cut recorded for this load; included in company profit gross.';
