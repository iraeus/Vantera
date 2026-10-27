CREATE TABLE IF NOT EXISTS public.custom_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, address)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_facilities TO authenticated;
ALTER TABLE public.custom_facilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_facilities_read ON public.custom_facilities;
CREATE POLICY custom_facilities_read ON public.custom_facilities
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS custom_facilities_write ON public.custom_facilities;
CREATE POLICY custom_facilities_write ON public.custom_facilities
  FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));

DROP POLICY IF EXISTS custom_facilities_update ON public.custom_facilities;
CREATE POLICY custom_facilities_update ON public.custom_facilities
  FOR UPDATE TO authenticated USING (public.can_write(auth.uid()))
  WITH CHECK (public.can_write(auth.uid()));

DROP POLICY IF EXISTS custom_facilities_delete ON public.custom_facilities;
CREATE POLICY custom_facilities_delete ON public.custom_facilities
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
