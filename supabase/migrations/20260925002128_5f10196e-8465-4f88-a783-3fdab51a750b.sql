ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS dot_number text, ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.trucks ADD COLUMN IF NOT EXISTS current_location text;
ALTER TABLE public.trailers ADD COLUMN IF NOT EXISTS current_location text, ADD COLUMN IF NOT EXISTS mileage integer, ADD COLUMN IF NOT EXISTS assigned_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS dispatcher_id uuid;
ALTER TABLE public.loads ADD COLUMN IF NOT EXISTS pickup_eta timestamptz, ADD COLUMN IF NOT EXISTS delivery_eta timestamptz, ADD COLUMN IF NOT EXISTS next_update_at timestamptz, ADD COLUMN IF NOT EXISTS deadhead_miles numeric NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department text;

CREATE TABLE public.broker_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  name text NOT NULL, title text, phone text, email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_contacts TO authenticated;
GRANT ALL ON public.broker_contacts TO service_role;
ALTER TABLE public.broker_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bc_read ON public.broker_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY bc_ins ON public.broker_contacts FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY bc_upd ON public.broker_contacts FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY bc_del ON public.broker_contacts FOR DELETE TO authenticated USING (public.can_write(auth.uid()));

CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, entity_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'activity', description text NOT NULL,
  actor_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_entity_idx ON public.activity_log(entity_type, entity_id, created_at DESC);
GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY al_read ON public.activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY al_ins ON public.activity_log FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()) AND actor_id = auth.uid());

CREATE TABLE public.entity_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, entity_id uuid NOT NULL,
  doc_type text NOT NULL DEFAULT 'other', file_name text NOT NULL, file_path text NOT NULL,
  expires_on date, uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_documents_idx ON public.entity_documents(entity_type, entity_id);
GRANT SELECT, INSERT, DELETE ON public.entity_documents TO authenticated;
GRANT ALL ON public.entity_documents TO service_role;
ALTER TABLE public.entity_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY ed_read ON public.entity_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY ed_ins ON public.entity_documents FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY ed_del ON public.entity_documents FOR DELETE TO authenticated USING (public.can_write(auth.uid()));

CREATE TABLE public.maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL CHECK (asset_type IN ('truck','trailer')), asset_id uuid NOT NULL,
  service_date date NOT NULL DEFAULT current_date, description text NOT NULL,
  cost numeric NOT NULL DEFAULT 0, odometer integer, vendor text,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_records TO authenticated;
GRANT ALL ON public.maintenance_records TO service_role;
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY mr_read ON public.maintenance_records FOR SELECT TO authenticated USING (true);
CREATE POLICY mr_ins ON public.maintenance_records FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY mr_upd ON public.maintenance_records FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY mr_del ON public.maintenance_records FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE public.fuel_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id uuid NOT NULL REFERENCES public.trucks(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  fuel_date date NOT NULL DEFAULT current_date, gallons numeric NOT NULL DEFAULT 0,
  cost numeric NOT NULL DEFAULT 0, odometer integer, state text, location text,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_records TO authenticated;
GRANT ALL ON public.fuel_records TO service_role;
ALTER TABLE public.fuel_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY fr_read ON public.fuel_records FOR SELECT TO authenticated USING (true);
CREATE POLICY fr_ins ON public.fuel_records FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY fr_upd ON public.fuel_records FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY fr_del ON public.fuel_records FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL, module text NOT NULL,
  can_view boolean NOT NULL DEFAULT false, can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false, can_delete boolean NOT NULL DEFAULT false,
  can_export boolean NOT NULL DEFAULT false, can_approve boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, module)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rp_read ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY rp_write ON public.role_permissions FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER role_permissions_updated_at BEFORE UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_export, can_approve)
SELECT r.role, m.module,
  -- view
  CASE WHEN r.role IN ('super_admin','admin') THEN true
       WHEN m.module IN ('users','roles','settings') THEN false
       ELSE true END,
  -- create
  CASE WHEN r.role IN ('super_admin','admin') THEN true
       WHEN r.role = 'dispatcher' AND m.module IN ('loads','updates','dispatch','drivers','trucks','trailers','brokers','customers','documents','tasks') THEN true
       WHEN r.role = 'updater' AND m.module IN ('updates','documents','tasks') THEN true
       WHEN r.role = 'accounting' AND m.module IN ('accounting','invoices','payments','settlements','brokers','customers','fuel','documents') THEN true
       WHEN r.role = 'safety' AND m.module IN ('drivers','compliance','safety','documents') THEN true
       WHEN r.role = 'fleet_manager' AND m.module IN ('trucks','trailers','drivers','maintenance','fuel','documents','compliance') THEN true
       WHEN r.role = 'maintenance' AND m.module IN ('maintenance','fuel','documents') THEN true
       ELSE false END,
  -- edit
  CASE WHEN r.role IN ('super_admin','admin') THEN true
       WHEN r.role = 'dispatcher' AND m.module IN ('loads','updates','dispatch','drivers','trucks','trailers','brokers','customers','documents','tasks') THEN true
       WHEN r.role = 'updater' AND m.module IN ('loads','updates','documents','tasks') THEN true
       WHEN r.role = 'accounting' AND m.module IN ('loads','accounting','invoices','payments','settlements','brokers','customers','fuel','documents') THEN true
       WHEN r.role = 'safety' AND m.module IN ('drivers','trucks','trailers','compliance','safety','documents') THEN true
       WHEN r.role = 'fleet_manager' AND m.module IN ('trucks','trailers','drivers','maintenance','fuel','documents','compliance') THEN true
       WHEN r.role = 'maintenance' AND m.module IN ('trucks','trailers','maintenance','fuel','documents') THEN true
       ELSE false END,
  r.role IN ('super_admin','admin'),
  CASE WHEN r.role IN ('super_admin','admin') THEN true
       WHEN r.role IN ('dispatcher','accounting','fleet_manager','safety') AND m.module NOT IN ('users','roles','settings') THEN true
       ELSE false END,
  CASE WHEN r.role IN ('super_admin','admin') THEN true
       WHEN r.role = 'accounting' AND m.module IN ('invoices','payments','settlements','accounting') THEN true
       ELSE false END
FROM unnest(enum_range(NULL::public.app_role)) AS r(role)
CROSS JOIN unnest(ARRAY['dashboard','loads','updates','dispatch','map','drivers','trucks','trailers','brokers','customers','accounting','invoices','payments','settlements','fuel','maintenance','documents','compliance','safety','reports','tasks','users','roles','settings']) AS m(module);

CREATE POLICY docs_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents');
CREATE POLICY docs_ins ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents' AND public.can_write(auth.uid()));
CREATE POLICY docs_del ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents' AND public.can_write(auth.uid()));