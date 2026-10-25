ALTER TABLE public.loads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.loads ADD COLUMN IF NOT EXISTS deleted_by uuid;