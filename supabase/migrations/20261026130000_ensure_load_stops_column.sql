-- Keep loads compatible with the multi-stop editor on databases where the
-- original itinerary migration has not been applied yet.
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS stops jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'loads_stops_array_check'
      AND conrelid = 'public.loads'::regclass
  ) THEN
    ALTER TABLE public.loads
      ADD CONSTRAINT loads_stops_array_check
      CHECK (jsonb_typeof(stops) = 'array');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
