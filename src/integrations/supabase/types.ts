export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      activity_log: {
        Row: {
          actor_id: string | null;
          created_at: string;
          description: string;
          entity_id: string;
          entity_type: string;
          id: string;
          kind: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          description: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          kind?: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          description?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          kind?: string;
        };
        Relationships: [];
      };
      broker_contacts: {
        Row: {
          broker_id: string;
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          phone: string | null;
          title: string | null;
        };
        Insert: {
          broker_id: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          title?: string | null;
        };
        Update: {
          broker_id?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          title?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "broker_contacts_broker_id_fkey";
            columns: ["broker_id"];
            isOneToOne: false;
            referencedRelation: "brokers";
            referencedColumns: ["id"];
          },
        ];
      };
      brokers: {
        Row: {
          address: string | null;
          contact_name: string | null;
          created_at: string;
          credit_rating: string | null;
          dot_number: string | null;
          email: string | null;
          id: string;
          is_active: boolean;
          is_customer: boolean;
          mc_number: string | null;
          name: string;
          notes: string | null;
          payment_terms: string | null;
          phone: string | null;
          updated_at: string;
          payment_terms_days: number;
        };
        Insert: {
          address?: string | null;
          contact_name?: string | null;
          created_at?: string;
          credit_rating?: string | null;
          dot_number?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_customer?: boolean;
          mc_number?: string | null;
          name: string;
          notes?: string | null;
          payment_terms?: string | null;
          phone?: string | null;
          updated_at?: string;
          payment_terms_days?: number;
        };
        Update: {
          address?: string | null;
          contact_name?: string | null;
          created_at?: string;
          credit_rating?: string | null;
          dot_number?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_customer?: boolean;
          mc_number?: string | null;
          name?: string;
          notes?: string | null;
          payment_terms?: string | null;
          phone?: string | null;
          updated_at?: string;
          payment_terms_days?: number;
        };
        Relationships: [];
      };
      drivers: {
        Row: {
          cdl_expiration: string | null;
          cdl_number: string | null;
          cdl_state: string | null;
          created_at: string;
          dispatch_note: string | null;
          dispatch_status: string;
          dispatcher_id: string | null;
          driver_code: string | null;
          email: string | null;
          full_name: string;
          hire_date: string | null;
          id: string;
          current_location: string | null;
          last_location_update: string | null;
          medical_card_expiration: string | null;
          notes: string | null;
          pay_rate: number | null;
          pay_type: string | null;
          phone: string | null;
          status: string;
          unit_number: string | null;
          updated_at: string;
        };
        Insert: {
          cdl_expiration?: string | null;
          cdl_number?: string | null;
          cdl_state?: string | null;
          created_at?: string;
          dispatch_note?: string | null;
          dispatch_status?: string;
          dispatcher_id?: string | null;
          driver_code?: string | null;
          email?: string | null;
          full_name: string;
          hire_date?: string | null;
          id?: string;
          current_location?: string | null;
          last_location_update?: string | null;
          medical_card_expiration?: string | null;
          notes?: string | null;
          pay_rate?: number | null;
          pay_type?: string | null;
          phone?: string | null;
          status?: string;
          unit_number?: string | null;
          updated_at?: string;
        };
        Update: {
          cdl_expiration?: string | null;
          cdl_number?: string | null;
          cdl_state?: string | null;
          created_at?: string;
          dispatch_note?: string | null;
          dispatch_status?: string;
          dispatcher_id?: string | null;
          driver_code?: string | null;
          email?: string | null;
          full_name?: string;
          hire_date?: string | null;
          id?: string;
          current_location?: string | null;
          last_location_update?: string | null;
          medical_card_expiration?: string | null;
          notes?: string | null;
          pay_rate?: number | null;
          pay_type?: string | null;
          phone?: string | null;
          status?: string;
          unit_number?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      entity_documents: {
        Row: {
          created_at: string;
          doc_type: string;
          entity_id: string;
          entity_type: string;
          expires_on: string | null;
          file_name: string;
          file_path: string;
          id: string;
          uploaded_by: string | null;
        };
        Insert: {
          created_at?: string;
          doc_type?: string;
          entity_id: string;
          entity_type: string;
          expires_on?: string | null;
          file_name: string;
          file_path: string;
          id?: string;
          uploaded_by?: string | null;
        };
        Update: {
          created_at?: string;
          doc_type?: string;
          entity_id?: string;
          entity_type?: string;
          expires_on?: string | null;
          file_name?: string;
          file_path?: string;
          id?: string;
          uploaded_by?: string | null;
        };
        Relationships: [];
      };
      fuel_records: {
        Row: {
          cost: number;
          created_at: string;
          created_by: string | null;
          driver_id: string | null;
          fuel_date: string;
          gallons: number;
          id: string;
          location: string | null;
          odometer: number | null;
          state: string | null;
          truck_id: string;
        };
        Insert: {
          cost?: number;
          created_at?: string;
          created_by?: string | null;
          driver_id?: string | null;
          fuel_date?: string;
          gallons?: number;
          id?: string;
          location?: string | null;
          odometer?: number | null;
          state?: string | null;
          truck_id: string;
        };
        Update: {
          cost?: number;
          created_at?: string;
          created_by?: string | null;
          driver_id?: string | null;
          fuel_date?: string;
          gallons?: number;
          id?: string;
          location?: string | null;
          odometer?: number | null;
          state?: string | null;
          truck_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fuel_records_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fuel_records_truck_id_fkey";
            columns: ["truck_id"];
            isOneToOne: false;
            referencedRelation: "trucks";
            referencedColumns: ["id"];
          },
        ];
      };
      load_documents: {
        Row: {
          created_at: string;
          doc_type: string;
          file_name: string;
          file_path: string;
          id: string;
          load_id: string;
          uploaded_by: string | null;
        };
        Insert: {
          created_at?: string;
          doc_type: string;
          file_name: string;
          file_path: string;
          id?: string;
          load_id: string;
          uploaded_by?: string | null;
        };
        Update: {
          created_at?: string;
          doc_type?: string;
          file_name?: string;
          file_path?: string;
          id?: string;
          load_id?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "load_documents_load_id_fkey";
            columns: ["load_id"];
            isOneToOne: false;
            referencedRelation: "loads";
            referencedColumns: ["id"];
          },
        ];
      };
      load_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          description: string | null;
          event_type: string;
          id: string;
          load_id: string;
          late_minutes: number | null;
          shift_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          description?: string | null;
          event_type: string;
          id?: string;
          load_id: string;
          late_minutes?: number | null;
          shift_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          description?: string | null;
          event_type?: string;
          id?: string;
          load_id?: string;
          late_minutes?: number | null;
          shift_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "load_events_load_id_fkey";
            columns: ["load_id"];
            isOneToOne: false;
            referencedRelation: "loads";
            referencedColumns: ["id"];
          },
        ];
      };
      loads: {
        Row: {
          broker_id: string | null;
          commodity: string | null;
          consignee: string | null;
          created_at: string;
          created_by: string | null;
          cut: number;
          current_location: string | null;
          customer_name: string | null;
          deadhead_miles: number;
          deleted_at: string | null;
          deleted_by: string | null;
          delivery_address: string | null;
          delivery_date: string | null;
          delivery_eta: string | null;
          delivery_location: string | null;
          delivery_time: string | null;
          detention: number;
          dispatcher_id: string | null;
          driver_id: string | null;
          driver_pay: number;
          equipment_type: string | null;
          eta: string | null;
          fuel_surcharge: number;
          id: string;
          is_problem: boolean;
          last_location_update: string | null;
          layover: number;
          load_number: string;
          miles: number | null;
          next_update_at: string | null;
          notes: string | null;
          other_charges: number;
          pickup_address: string | null;
          pickup_date: string | null;
          pickup_eta: string | null;
          pickup_location: string | null;
          pickup_time: string | null;
          pieces: number | null;
          problem_note: string | null;
          rate: number;
          shipper: string | null;
          special_instructions: string | null;
          status: string;
          tonu_amount: number;
          trailer_id: string | null;
          truck_id: string | null;
          updated_at: string;
          weight: number | null;
          delivered_at: string | null;
          invoice_number: string | null;
          invoice_date: string | null;
          paid_date: string | null;
          pickup_arrived_at: string | null;
          pickup_departed_at: string | null;
          delivery_arrived_at: string | null;
          delivery_departed_at: string | null;
        };
        Insert: {
          broker_id?: string | null;
          commodity?: string | null;
          consignee?: string | null;
          created_at?: string;
          created_by?: string | null;
          cut?: number;
          current_location?: string | null;
          customer_name?: string | null;
          deadhead_miles?: number;
          deleted_at?: string | null;
          deleted_by?: string | null;
          delivery_address?: string | null;
          delivery_date?: string | null;
          delivery_eta?: string | null;
          delivery_location?: string | null;
          delivery_time?: string | null;
          detention?: number;
          dispatcher_id?: string | null;
          driver_id?: string | null;
          driver_pay?: number;
          equipment_type?: string | null;
          eta?: string | null;
          fuel_surcharge?: number;
          id?: string;
          is_problem?: boolean;
          last_location_update?: string | null;
          layover?: number;
          load_number: string;
          miles?: number | null;
          next_update_at?: string | null;
          notes?: string | null;
          other_charges?: number;
          pickup_address?: string | null;
          pickup_date?: string | null;
          pickup_eta?: string | null;
          pickup_location?: string | null;
          pickup_time?: string | null;
          pieces?: number | null;
          problem_note?: string | null;
          rate?: number;
          shipper?: string | null;
          special_instructions?: string | null;
          status?: string;
          tonu_amount?: number;
          trailer_id?: string | null;
          truck_id?: string | null;
          updated_at?: string;
          weight?: number | null;
          delivered_at?: string | null;
          invoice_number?: string | null;
          invoice_date?: string | null;
          paid_date?: string | null;
          pickup_arrived_at?: string | null;
          pickup_departed_at?: string | null;
          delivery_arrived_at?: string | null;
          delivery_departed_at?: string | null;
        };
        Update: {
          broker_id?: string | null;
          commodity?: string | null;
          consignee?: string | null;
          created_at?: string;
          created_by?: string | null;
          cut?: number;
          current_location?: string | null;
          customer_name?: string | null;
          deadhead_miles?: number;
          deleted_at?: string | null;
          deleted_by?: string | null;
          delivery_address?: string | null;
          delivery_date?: string | null;
          delivery_eta?: string | null;
          delivery_location?: string | null;
          delivery_time?: string | null;
          detention?: number;
          dispatcher_id?: string | null;
          driver_id?: string | null;
          driver_pay?: number;
          equipment_type?: string | null;
          eta?: string | null;
          fuel_surcharge?: number;
          id?: string;
          is_problem?: boolean;
          last_location_update?: string | null;
          layover?: number;
          load_number?: string;
          miles?: number | null;
          next_update_at?: string | null;
          notes?: string | null;
          other_charges?: number;
          pickup_address?: string | null;
          pickup_date?: string | null;
          pickup_eta?: string | null;
          pickup_location?: string | null;
          pickup_time?: string | null;
          pieces?: number | null;
          problem_note?: string | null;
          rate?: number;
          shipper?: string | null;
          special_instructions?: string | null;
          status?: string;
          tonu_amount?: number;
          trailer_id?: string | null;
          truck_id?: string | null;
          updated_at?: string;
          weight?: number | null;
          delivered_at?: string | null;
          invoice_number?: string | null;
          invoice_date?: string | null;
          paid_date?: string | null;
          pickup_arrived_at?: string | null;
          pickup_departed_at?: string | null;
          delivery_arrived_at?: string | null;
          delivery_departed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "loads_broker_id_fkey";
            columns: ["broker_id"];
            isOneToOne: false;
            referencedRelation: "brokers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loads_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loads_trailer_id_fkey";
            columns: ["trailer_id"];
            isOneToOne: false;
            referencedRelation: "trailers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loads_truck_id_fkey";
            columns: ["truck_id"];
            isOneToOne: false;
            referencedRelation: "trucks";
            referencedColumns: ["id"];
          },
        ];
      };
      maintenance_records: {
        Row: {
          asset_id: string;
          asset_type: string;
          cost: number;
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          odometer: number | null;
          service_date: string;
          vendor: string | null;
        };
        Insert: {
          asset_id: string;
          asset_type: string;
          cost?: number;
          created_at?: string;
          created_by?: string | null;
          description: string;
          id?: string;
          odometer?: number | null;
          service_date?: string;
          vendor?: string | null;
        };
        Update: {
          asset_id?: string;
          asset_type?: string;
          cost?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          odometer?: number | null;
          service_date?: string;
          vendor?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          department: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          is_active: boolean;
          job_title: string | null;
          phone: string | null;
          username: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          department?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          job_title?: string | null;
          phone?: string | null;
          username?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          department?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          job_title?: string | null;
          phone?: string | null;
          username?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          can_approve: boolean;
          can_create: boolean;
          can_delete: boolean;
          can_edit: boolean;
          can_export: boolean;
          can_view: boolean;
          module: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
        };
        Insert: {
          can_approve?: boolean;
          can_create?: boolean;
          can_delete?: boolean;
          can_edit?: boolean;
          can_export?: boolean;
          can_view?: boolean;
          module: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Update: {
          can_approve?: boolean;
          can_create?: boolean;
          can_delete?: boolean;
          can_edit?: boolean;
          can_export?: boolean;
          can_view?: boolean;
          module?: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      trailers: {
        Row: {
          assigned_driver_id: string | null;
          assigned_truck_id: string | null;
          created_at: string;
          current_location: string | null;
          id: string;
          insurance_expiration: string | null;
          make: string | null;
          mileage: number | null;
          model: string | null;
          notes: string | null;
          plate: string | null;
          plate_state: string | null;
          registration_expiration: string | null;
          status: string;
          trailer_number: string;
          trailer_type: string | null;
          updated_at: string;
          vin: string | null;
          year: number | null;
        };
        Insert: {
          assigned_driver_id?: string | null;
          assigned_truck_id?: string | null;
          created_at?: string;
          current_location?: string | null;
          id?: string;
          insurance_expiration?: string | null;
          make?: string | null;
          mileage?: number | null;
          model?: string | null;
          notes?: string | null;
          plate?: string | null;
          plate_state?: string | null;
          registration_expiration?: string | null;
          status?: string;
          trailer_number: string;
          trailer_type?: string | null;
          updated_at?: string;
          vin?: string | null;
          year?: number | null;
        };
        Update: {
          assigned_driver_id?: string | null;
          assigned_truck_id?: string | null;
          created_at?: string;
          current_location?: string | null;
          id?: string;
          insurance_expiration?: string | null;
          make?: string | null;
          mileage?: number | null;
          model?: string | null;
          notes?: string | null;
          plate?: string | null;
          plate_state?: string | null;
          registration_expiration?: string | null;
          status?: string;
          trailer_number?: string;
          trailer_type?: string | null;
          updated_at?: string;
          vin?: string | null;
          year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "trailers_assigned_driver_id_fkey";
            columns: ["assigned_driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trailers_assigned_truck_id_fkey";
            columns: ["assigned_truck_id"];
            isOneToOne: false;
            referencedRelation: "trucks";
            referencedColumns: ["id"];
          },
        ];
      };
      trucks: {
        Row: {
          assigned_driver_id: string | null;
          created_at: string;
          current_location: string | null;
          id: string;
          inspection_due: string | null;
          insurance_expiration: string | null;
          make: string | null;
          mileage: number | null;
          model: string | null;
          notes: string | null;
          ownership: string | null;
          plate: string | null;
          plate_state: string | null;
          registration_expiration: string | null;
          status: string;
          truck_number: string;
          updated_at: string;
          vin: string | null;
          year: number | null;
        };
        Insert: {
          assigned_driver_id?: string | null;
          created_at?: string;
          current_location?: string | null;
          id?: string;
          inspection_due?: string | null;
          insurance_expiration?: string | null;
          make?: string | null;
          mileage?: number | null;
          model?: string | null;
          notes?: string | null;
          ownership?: string | null;
          plate?: string | null;
          plate_state?: string | null;
          registration_expiration?: string | null;
          status?: string;
          truck_number: string;
          updated_at?: string;
          vin?: string | null;
          year?: number | null;
        };
        Update: {
          assigned_driver_id?: string | null;
          created_at?: string;
          current_location?: string | null;
          id?: string;
          inspection_due?: string | null;
          insurance_expiration?: string | null;
          make?: string | null;
          mileage?: number | null;
          model?: string | null;
          notes?: string | null;
          ownership?: string | null;
          plate?: string | null;
          plate_state?: string | null;
          registration_expiration?: string | null;
          status?: string;
          truck_number?: string;
          updated_at?: string;
          vin?: string | null;
          year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "trucks_assigned_driver_id_fkey";
            columns: ["assigned_driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_write: { Args: { _user_id: string }; Returns: boolean };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_admin: { Args: { _user_id: string }; Returns: boolean };
      is_supervisor: { Args: { _user_id: string }; Returns: boolean };
    };
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "supervisor"
        | "dispatcher"
        | "updater"
        | "accounting"
        | "safety"
        | "fleet_manager"
        | "maintenance"
        | "viewer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "supervisor",
        "dispatcher",
        "updater",
        "accounting",
        "safety",
        "fleet_manager",
        "maintenance",
        "viewer",
      ],
    },
  },
} as const;
