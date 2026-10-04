// Gerado por `supabase gen types typescript` (MCP generate_typescript_types)
// a partir do projeto qwaywbtyfkovulvirujp. Não edite à mão: regenere após
// cada migração (ver supabase/README.md).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          body: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          occurred_at: string
          organization_id: string
          property_id: string | null
          type: Database["public"]["Enums"]["activity_type"]
          updated_at: string
        }
        Insert: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          property_id?: string | null
          type: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Update: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          property_id?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_usage_periods: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          conversations: number
          cost_millicents: number
          created_at: string
          day_cost_millicents: number
          day_start: string | null
          input_tokens: number
          notified_100_at: string | null
          notified_80_at: string | null
          organization_id: string
          output_tokens: number
          period_end: string
          period_start: string
          requests: number
          updated_at: string
          week_cost_millicents: number
          week_start: string | null
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          conversations?: number
          cost_millicents?: number
          created_at?: string
          day_cost_millicents?: number
          day_start?: string | null
          input_tokens?: number
          notified_100_at?: string | null
          notified_80_at?: string | null
          organization_id: string
          output_tokens?: number
          period_end: string
          period_start: string
          requests?: number
          updated_at?: string
          week_cost_millicents?: number
          week_start?: string | null
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          conversations?: number
          cost_millicents?: number
          created_at?: string
          day_cost_millicents?: number
          day_start?: string | null
          input_tokens?: number
          notified_100_at?: string | null
          notified_80_at?: string | null
          organization_id?: string
          output_tokens?: number
          period_end?: string
          period_start?: string
          requests?: number
          updated_at?: string
          week_cost_millicents?: number
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          broker_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          feedback: string | null
          id: string
          meeting_point: string | null
          organization_id: string
          property_id: string | null
          rating: number | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          broker_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          feedback?: string | null
          id?: string
          meeting_point?: string | null
          organization_id: string
          property_id?: string | null
          rating?: number | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          broker_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          feedback?: string | null
          id?: string
          meeting_point?: string | null
          organization_id?: string
          property_id?: string | null
          rating?: number | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_accounts: {
        Row: {
          addon_keys: string[]
          ai_overage_cap_cents: number
          billing_interval: string | null
          cancel_at_period_end: boolean
          current_period_end: string | null
          features: string[]
          first_paid_at: string | null
          limits: Json
          organization_id: string
          owned_listing_packs: number
          plan_key: string
          plan_net_invoice_at: string | null
          plan_net_monthly_cents: number | null
          platform_blocked_at: string | null
          platform_blocked_reason: string | null
          referral_confirmed_notified_at: string | null
          referral_counted_at: string | null
          referral_discount_percent: number
          referral_ineligible_at: string | null
          referral_ineligible_reason: string | null
          seats: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          synced_at: string
          trial_ends_at: string
        }
        Insert: {
          addon_keys?: string[]
          ai_overage_cap_cents?: number
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          features?: string[]
          first_paid_at?: string | null
          limits: Json
          organization_id: string
          owned_listing_packs?: number
          plan_key?: string
          plan_net_invoice_at?: string | null
          plan_net_monthly_cents?: number | null
          platform_blocked_at?: string | null
          platform_blocked_reason?: string | null
          referral_confirmed_notified_at?: string | null
          referral_counted_at?: string | null
          referral_discount_percent?: number
          referral_ineligible_at?: string | null
          referral_ineligible_reason?: string | null
          seats?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          synced_at?: string
          trial_ends_at: string
        }
        Update: {
          addon_keys?: string[]
          ai_overage_cap_cents?: number
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          features?: string[]
          first_paid_at?: string | null
          limits?: Json
          organization_id?: string
          owned_listing_packs?: number
          plan_key?: string
          plan_net_invoice_at?: string | null
          plan_net_monthly_cents?: number | null
          platform_blocked_at?: string | null
          platform_blocked_reason?: string | null
          referral_confirmed_notified_at?: string | null
          referral_counted_at?: string | null
          referral_discount_percent?: number
          referral_ineligible_at?: string | null
          referral_ineligible_reason?: string | null
          seats?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          synced_at?: string
          trial_ends_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      caixa_catalog_status: {
        Row: {
          atualizado_em: string
          checks_since_change: number
          last_changed_at: string | null
          last_checked_at: string | null
          last_failure_at: string | null
          last_failure_reason: string | null
          last_result: string | null
          lista_gerada_em: string | null
          sincronizado_em: string | null
          singleton: boolean
          source_digest: string | null
          source_etag: string | null
          source_last_modified: string | null
          total_ativo: number
          ultima_carga_recusada: number
          ultima_carga_saiu: number
          ultima_carga_total: number
        }
        Insert: {
          atualizado_em?: string
          checks_since_change?: number
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_result?: string | null
          lista_gerada_em?: string | null
          sincronizado_em?: string | null
          singleton?: boolean
          source_digest?: string | null
          source_etag?: string | null
          source_last_modified?: string | null
          total_ativo?: number
          ultima_carga_recusada?: number
          ultima_carga_saiu?: number
          ultima_carga_total?: number
        }
        Update: {
          atualizado_em?: string
          checks_since_change?: number
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_result?: string | null
          lista_gerada_em?: string | null
          sincronizado_em?: string | null
          singleton?: boolean
          source_digest?: string | null
          source_etag?: string | null
          source_last_modified?: string | null
          total_ativo?: number
          ultima_carga_recusada?: number
          ultima_carga_saiu?: number
          ultima_carga_total?: number
        }
        Relationships: []
      }
      caixa_client_links: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          notes: string | null
          numero: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          numero: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          numero?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "caixa_client_links_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "caixa_client_links_lead_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "caixa_client_links_numero_fkey"
            columns: ["numero"]
            isOneToOne: false
            referencedRelation: "caixa_listings"
            referencedColumns: ["numero"]
          },
          {
            foreignKeyName: "caixa_client_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      caixa_favorites: {
        Row: {
          created_at: string
          numero: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          numero: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          numero?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "caixa_favorites_numero_fkey"
            columns: ["numero"]
            isOneToOne: false
            referencedRelation: "caixa_listings"
            referencedColumns: ["numero"]
          },
          {
            foreignKeyName: "caixa_favorites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      caixa_listings: {
        Row: {
          aceita_financiamento: boolean | null
          area_privativa: number | null
          area_terreno: number | null
          area_total: number | null
          atualizado_em: string
          bairro: string | null
          cidade: string
          desconto: number | null
          descricao: string | null
          endereco: string
          link: string
          lista_gerada_em: string | null
          modalidade: string | null
          numero: string
          preco: number
          primeira_vez_em: string
          quartos: number | null
          saiu_da_lista_em: string | null
          sincronizacao_id: string
          tipo: Database["public"]["Enums"]["property_type"]
          uf: string
          vagas: number | null
          valor_avaliacao: number | null
        }
        Insert: {
          aceita_financiamento?: boolean | null
          area_privativa?: number | null
          area_terreno?: number | null
          area_total?: number | null
          atualizado_em?: string
          bairro?: string | null
          cidade: string
          desconto?: number | null
          descricao?: string | null
          endereco: string
          link: string
          lista_gerada_em?: string | null
          modalidade?: string | null
          numero: string
          preco: number
          primeira_vez_em?: string
          quartos?: number | null
          saiu_da_lista_em?: string | null
          sincronizacao_id: string
          tipo?: Database["public"]["Enums"]["property_type"]
          uf: string
          vagas?: number | null
          valor_avaliacao?: number | null
        }
        Update: {
          aceita_financiamento?: boolean | null
          area_privativa?: number | null
          area_terreno?: number | null
          area_total?: number | null
          atualizado_em?: string
          bairro?: string | null
          cidade?: string
          desconto?: number | null
          descricao?: string | null
          endereco?: string
          link?: string
          lista_gerada_em?: string | null
          modalidade?: string | null
          numero?: string
          preco?: number
          primeira_vez_em?: string
          quartos?: number | null
          saiu_da_lista_em?: string | null
          sincronizacao_id?: string
          tipo?: Database["public"]["Enums"]["property_type"]
          uf?: string
          vagas?: number | null
          valor_avaliacao?: number | null
        }
        Relationships: []
      }
      caixa_sync_events: {
        Row: {
          id: number
          lista_gerada_em: string | null
          motivo: string | null
          ocorrido_em: string
          origem: string
          recusados: number | null
          resultado: string
          sairam: number | null
          source_last_modified: string | null
          total: number | null
          verificacoes: number | null
        }
        Insert: {
          id?: never
          lista_gerada_em?: string | null
          motivo?: string | null
          ocorrido_em?: string
          origem?: string
          recusados?: number | null
          resultado: string
          sairam?: number | null
          source_last_modified?: string | null
          total?: number | null
          verificacoes?: number | null
        }
        Update: {
          id?: never
          lista_gerada_em?: string | null
          motivo?: string | null
          ocorrido_em?: string
          origem?: string
          recusados?: number | null
          resultado?: string
          sairam?: number | null
          source_last_modified?: string | null
          total?: number | null
          verificacoes?: number | null
        }
        Relationships: []
      }
      capture_requests: {
        Row: {
          city: string | null
          consent_at: string
          converted_property_id: string | null
          created_at: string
          expected_price: number | null
          id: string
          message: string | null
          neighborhood: string | null
          organization_id: string
          owner_email: string | null
          owner_name: string
          owner_phone: string | null
          postal_code: string | null
          purpose: Database["public"]["Enums"]["listing_purpose"]
          state: string | null
          status: Database["public"]["Enums"]["capture_request_status"]
          type: Database["public"]["Enums"]["property_type"] | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          consent_at: string
          converted_property_id?: string | null
          created_at?: string
          expected_price?: number | null
          id?: string
          message?: string | null
          neighborhood?: string | null
          organization_id: string
          owner_email?: string | null
          owner_name: string
          owner_phone?: string | null
          postal_code?: string | null
          purpose: Database["public"]["Enums"]["listing_purpose"]
          state?: string | null
          status?: Database["public"]["Enums"]["capture_request_status"]
          type?: Database["public"]["Enums"]["property_type"] | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          consent_at?: string
          converted_property_id?: string | null
          created_at?: string
          expected_price?: number | null
          id?: string
          message?: string | null
          neighborhood?: string | null
          organization_id?: string
          owner_email?: string | null
          owner_name?: string
          owner_phone?: string | null
          postal_code?: string | null
          purpose?: Database["public"]["Enums"]["listing_purpose"]
          state?: string | null
          status?: Database["public"]["Enums"]["capture_request_status"]
          type?: Database["public"]["Enums"]["property_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_requests_converted_property_fkey"
            columns: ["organization_id", "converted_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "capture_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_documents: {
        Row: {
          client_id: string
          created_at: string
          id: string
          mime_type: string | null
          name: string
          organization_id: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          mime_type?: string | null
          name: string
          organization_id: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          name?: string
          organization_id?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_interests: {
        Row: {
          active: boolean
          city: string | null
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          max_price: number | null
          min_bedrooms: number | null
          min_parking: number | null
          min_price: number | null
          neighborhoods: string[]
          notes: string | null
          organization_id: string
          purpose: Database["public"]["Enums"]["listing_purpose"]
          types: Database["public"]["Enums"]["property_type"][]
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          max_price?: number | null
          min_bedrooms?: number | null
          min_parking?: number | null
          min_price?: number | null
          neighborhoods?: string[]
          notes?: string | null
          organization_id: string
          purpose: Database["public"]["Enums"]["listing_purpose"]
          types?: Database["public"]["Enums"]["property_type"][]
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          max_price?: number | null
          min_bedrooms?: number | null
          min_parking?: number | null
          min_price?: number | null
          neighborhoods?: string[]
          notes?: string | null
          organization_id?: string
          purpose?: Database["public"]["Enums"]["listing_purpose"]
          types?: Database["public"]["Enums"]["property_type"][]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_interests_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_interests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_shares: {
        Row: {
          client_id: string
          created_at: string
          id: string
          organization_id: string
          shared_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          organization_id: string
          shared_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          shared_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_shares_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          anonymized_at: string | null
          assigned_to: string | null
          birth_date: string | null
          city: string | null
          complement: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          document: string | null
          email: string | null
          id: string
          identification_kept_until: string | null
          kind: Database["public"]["Enums"]["client_kind"]
          lgpd_consent_at: string | null
          lgpd_legal_basis: string | null
          name: string
          neighborhood: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          rg: string | null
          source: string | null
          state: string | null
          street: string | null
          street_number: string | null
          tags: string[]
          trade_name: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          anonymized_at?: string | null
          assigned_to?: string | null
          birth_date?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document?: string | null
          email?: string | null
          id?: string
          identification_kept_until?: string | null
          kind?: Database["public"]["Enums"]["client_kind"]
          lgpd_consent_at?: string | null
          lgpd_legal_basis?: string | null
          name: string
          neighborhood?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          rg?: string | null
          source?: string | null
          state?: string | null
          street?: string | null
          street_number?: string | null
          tags?: string[]
          trade_name?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          anonymized_at?: string | null
          assigned_to?: string | null
          birth_date?: string | null
          city?: string | null
          complement?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document?: string | null
          email?: string | null
          id?: string
          identification_kept_until?: string | null
          kind?: Database["public"]["Enums"]["client_kind"]
          lgpd_consent_at?: string | null
          lgpd_legal_basis?: string | null
          name?: string
          neighborhood?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          rg?: string | null
          source?: string | null
          state?: string | null
          street?: string | null
          street_number?: string | null
          tags?: string[]
          trade_name?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          agency_percent: number
          basis: Database["public"]["Enums"]["commission_basis"]
          capturer_percent: number
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          fixed_cents: number
          id: string
          manager_percent: number
          note: string | null
          organization_id: string
          partner_percent: number
          percent: number
          purpose: Database["public"]["Enums"]["listing_purpose"]
          seller_percent: number
        }
        Insert: {
          agency_percent?: number
          basis?: Database["public"]["Enums"]["commission_basis"]
          capturer_percent?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          fixed_cents?: number
          id?: string
          manager_percent?: number
          note?: string | null
          organization_id: string
          partner_percent?: number
          percent?: number
          purpose: Database["public"]["Enums"]["listing_purpose"]
          seller_percent?: number
        }
        Update: {
          agency_percent?: number
          basis?: Database["public"]["Enums"]["commission_basis"]
          capturer_percent?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          fixed_cents?: number
          id?: string
          manager_percent?: number
          note?: string | null
          organization_id?: string
          partner_percent?: number
          percent?: number
          purpose?: Database["public"]["Enums"]["listing_purpose"]
          seller_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_settings: {
        Row: {
          created_at: string
          discount_approval_enabled: boolean
          manager_user_id: string | null
          max_discount_percent: number
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          discount_approval_enabled?: boolean
          manager_user_id?: string | null
          max_discount_percent?: number
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          discount_approval_enabled?: boolean
          manager_user_id?: string | null
          max_discount_percent?: number
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_shares: {
        Row: {
          amount_cents: number
          commission_id: string
          created_at: string
          id: string
          organization_id: string
          paid_at: string | null
          paid_by: string | null
          paid_note: string | null
          partner_name: string | null
          percent: number
          role: Database["public"]["Enums"]["commission_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          commission_id: string
          created_at?: string
          id?: string
          organization_id: string
          paid_at?: string | null
          paid_by?: string | null
          paid_note?: string | null
          partner_name?: string | null
          percent: number
          role: Database["public"]["Enums"]["commission_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          commission_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          paid_at?: string | null
          paid_by?: string | null
          paid_note?: string | null
          partner_name?: string | null
          percent?: number
          role?: Database["public"]["Enums"]["commission_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_shares_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          client_id: string | null
          client_name: string | null
          closed_at: string
          created_at: string
          deal_amount_cents: number
          id: string
          note: string | null
          organization_id: string
          property_code: string | null
          property_id: string | null
          property_title: string | null
          proposal_id: string | null
          purpose: Database["public"]["Enums"]["listing_purpose"]
          rule_id: string | null
          rule_snapshot: Json
          status: Database["public"]["Enums"]["commission_status"]
          total_cents: number
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_name?: string | null
          closed_at?: string
          created_at?: string
          deal_amount_cents: number
          id?: string
          note?: string | null
          organization_id: string
          property_code?: string | null
          property_id?: string | null
          property_title?: string | null
          proposal_id?: string | null
          purpose: Database["public"]["Enums"]["listing_purpose"]
          rule_id?: string | null
          rule_snapshot: Json
          status?: Database["public"]["Enums"]["commission_status"]
          total_cents: number
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_name?: string | null
          closed_at?: string
          created_at?: string
          deal_amount_cents?: number
          id?: string
          note?: string | null
          organization_id?: string
          property_code?: string | null
          property_id?: string | null
          property_title?: string | null
          proposal_id?: string | null
          purpose?: Database["public"]["Enums"]["listing_purpose"]
          rule_id?: string | null
          rule_snapshot?: Json
          status?: Database["public"]["Enums"]["commission_status"]
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "client_property_matches"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "commissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      condominiums: {
        Row: {
          amenities: string[]
          avg_condo_fee: number | null
          city: string | null
          complement: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          neighborhood: string | null
          notes: string | null
          organization_id: string
          postal_code: string | null
          state: string | null
          street: string | null
          street_number: string | null
          updated_at: string
        }
        Insert: {
          amenities?: string[]
          avg_condo_fee?: number | null
          city?: string | null
          complement?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          neighborhood?: string | null
          notes?: string | null
          organization_id: string
          postal_code?: string | null
          state?: string | null
          street?: string | null
          street_number?: string | null
          updated_at?: string
        }
        Update: {
          amenities?: string[]
          avg_condo_fee?: number | null
          city?: string | null
          complement?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          neighborhood?: string | null
          notes?: string | null
          organization_id?: string
          postal_code?: string | null
          state?: string | null
          street?: string | null
          street_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "condominiums_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_accounts: {
        Row: {
          blocked_at: string | null
          blocked_reason: string | null
          connected_at: string
          connected_by: string | null
          created_at: string
          credential_expires_at: string | null
          credential_secret_id: string | null
          display_name: string | null
          enabled: boolean
          external_account_id: string
          external_owner_id: string | null
          handle: string | null
          id: string
          last_error_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          last_synced_at: string | null
          metadata: Json
          organization_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          scopes: string[]
          status: Database["public"]["Enums"]["connection_status"]
          terms_acceptance_id: string | null
          updated_at: string
        }
        Insert: {
          blocked_at?: string | null
          blocked_reason?: string | null
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credential_secret_id?: string | null
          display_name?: string | null
          enabled?: boolean
          external_account_id: string
          external_owner_id?: string | null
          handle?: string | null
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_synced_at?: string | null
          metadata?: Json
          organization_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          terms_acceptance_id?: string | null
          updated_at?: string
        }
        Update: {
          blocked_at?: string | null
          blocked_reason?: string | null
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credential_secret_id?: string | null
          display_name?: string | null
          enabled?: boolean
          external_account_id?: string
          external_owner_id?: string | null
          handle?: string | null
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_synced_at?: string | null
          metadata?: Json
          organization_id?: string
          provider?: Database["public"]["Enums"]["connection_provider"]
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          terms_acceptance_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connected_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connected_accounts_terms_fkey"
            columns: ["organization_id", "terms_acceptance_id"]
            isOneToOne: false
            referencedRelation: "connection_terms_acceptances"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      connection_events: {
        Row: {
          action: Database["public"]["Enums"]["connection_event_action"]
          actor_id: string | null
          connected_account_id: string | null
          created_at: string
          details: Json
          id: string
          organization_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          reason: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["connection_event_action"]
          actor_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          organization_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          reason?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["connection_event_action"]
          actor_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          organization_id?: string
          provider?: Database["public"]["Enums"]["connection_provider"]
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connection_events_account_fkey"
            columns: ["organization_id", "connected_account_id"]
            isOneToOne: false
            referencedRelation: "connected_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "connection_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connection_terms_acceptances: {
        Row: {
          accepted_at: string
          accepted_by: string
          created_at: string
          displayed_text: string
          displayed_text_sha256: string
          id: string
          ip_hash: string | null
          organization_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_evidence: Json
          terms_key: string
          terms_url: string
          terms_version: string
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          accepted_by: string
          created_at?: string
          displayed_text: string
          displayed_text_sha256: string
          id?: string
          ip_hash?: string | null
          organization_id: string
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_evidence?: Json
          terms_key: string
          terms_url: string
          terms_version: string
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          accepted_by?: string
          created_at?: string
          displayed_text?: string
          displayed_text_sha256?: string
          id?: string
          ip_hash?: string | null
          organization_id?: string
          provider?: Database["public"]["Enums"]["connection_provider"]
          provider_evidence?: Json
          terms_key?: string
          terms_url?: string
          terms_version?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connection_terms_acceptances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          action: Database["public"]["Enums"]["consent_action"]
          channel: Database["public"]["Enums"]["consent_channel"]
          client_id: string | null
          collected_at: string
          created_at: string
          disclosure_sha256: string
          disclosure_text: string
          evidence: Json
          id: string
          lead_id: string | null
          organization_id: string
          policy_version: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_by: string | null
          revokes_id: string | null
          source: Database["public"]["Enums"]["consent_source"]
          subject_address: string
          subject_name: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["consent_action"]
          channel: Database["public"]["Enums"]["consent_channel"]
          client_id?: string | null
          collected_at?: string
          created_at?: string
          disclosure_sha256: string
          disclosure_text: string
          evidence?: Json
          id?: string
          lead_id?: string | null
          organization_id: string
          policy_version: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_by?: string | null
          revokes_id?: string | null
          source: Database["public"]["Enums"]["consent_source"]
          subject_address: string
          subject_name?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["consent_action"]
          channel?: Database["public"]["Enums"]["consent_channel"]
          client_id?: string | null
          collected_at?: string
          created_at?: string
          disclosure_sha256?: string
          disclosure_text?: string
          evidence?: Json
          id?: string
          lead_id?: string | null
          organization_id?: string
          policy_version?: string
          purpose?: Database["public"]["Enums"]["consent_purpose"]
          recorded_by?: string | null
          revokes_id?: string | null
          source?: Database["public"]["Enums"]["consent_source"]
          subject_address?: string
          subject_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "consent_records_lead_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "consent_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_revokes_fkey"
            columns: ["organization_id", "revokes_id"]
            isOneToOne: false
            referencedRelation: "consent_records"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      data_erasure_receipts: {
        Row: {
          entity: string
          executed_at: string
          executed_by: string | null
          files_queued: number
          id: string
          identification_kept_until: string | null
          legal_holds: string[]
          organization_id: string
          outcome: string
          reason: string
          record_id: string
        }
        Insert: {
          entity: string
          executed_at?: string
          executed_by?: string | null
          files_queued?: number
          id?: string
          identification_kept_until?: string | null
          legal_holds?: string[]
          organization_id: string
          outcome: string
          reason: string
          record_id: string
        }
        Update: {
          entity?: string
          executed_at?: string
          executed_by?: string | null
          files_queued?: number
          id?: string
          identification_kept_until?: string | null
          legal_holds?: string[]
          organization_id?: string
          outcome?: string
          reason?: string
          record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_erasure_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_preferences: {
        Row: {
          created_at: string
          daily_digest: boolean
          getting_started_dismissed_at: string | null
          large_text: boolean
          task_reminders: boolean
          updated_at: string
          user_id: string
          visit_assigned: boolean
          visit_reminders: boolean
          weekly_report: boolean
        }
        Insert: {
          created_at?: string
          daily_digest?: boolean
          getting_started_dismissed_at?: string | null
          large_text?: boolean
          task_reminders?: boolean
          updated_at?: string
          user_id: string
          visit_assigned?: boolean
          visit_reminders?: boolean
          weekly_report?: boolean
        }
        Update: {
          created_at?: string
          daily_digest?: boolean
          getting_started_dismissed_at?: string | null
          large_text?: boolean
          task_reminders?: boolean
          updated_at?: string
          user_id?: string
          visit_assigned?: boolean
          visit_reminders?: boolean
          weekly_report?: boolean
        }
        Relationships: []
      }
      import_job_batches: {
        Row: {
          batch_index: number
          created_at: string
          failed_count: number
          inserted_count: number
          job_id: string
          organization_id: string
          results: Json
          row_count: number
          skipped_count: number
          updated_count: number
        }
        Insert: {
          batch_index: number
          created_at?: string
          failed_count?: number
          inserted_count?: number
          job_id: string
          organization_id: string
          results?: Json
          row_count: number
          skipped_count?: number
          updated_count?: number
        }
        Update: {
          batch_index?: number
          created_at?: string
          failed_count?: number
          inserted_count?: number
          job_id?: string
          organization_id?: string
          results?: Json
          row_count?: number
          skipped_count?: number
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_job_batches_job_fkey"
            columns: ["organization_id", "job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          duplicate_mode: Database["public"]["Enums"]["import_duplicate_mode"]
          failed_count: number
          finished_at: string | null
          id: string
          inserted_count: number
          kind: Database["public"]["Enums"]["import_kind"]
          options: Json
          organization_id: string
          skipped_count: number
          total_rows: number
          undone_at: string | null
          undone_by: string | null
          updated_at: string
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duplicate_mode?: Database["public"]["Enums"]["import_duplicate_mode"]
          failed_count?: number
          finished_at?: string | null
          id?: string
          inserted_count?: number
          kind: Database["public"]["Enums"]["import_kind"]
          options?: Json
          organization_id: string
          skipped_count?: number
          total_rows: number
          undone_at?: string | null
          undone_by?: string | null
          updated_at?: string
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duplicate_mode?: Database["public"]["Enums"]["import_duplicate_mode"]
          failed_count?: number
          finished_at?: string | null
          id?: string
          inserted_count?: number
          kind?: Database["public"]["Enums"]["import_kind"]
          options?: Json
          organization_id?: string
          skipped_count?: number
          total_rows?: number
          undone_at?: string | null
          undone_by?: string | null
          updated_at?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      key_movements: {
        Row: {
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          key_id: string
          notes: string | null
          organization_id: string
          returned_at: string | null
          taken_at: string
          taken_by_client_id: string | null
          taken_by_user: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          key_id: string
          notes?: string | null
          organization_id: string
          returned_at?: string | null
          taken_at?: string
          taken_by_client_id?: string | null
          taken_by_user?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          key_id?: string
          notes?: string | null
          organization_id?: string
          returned_at?: string | null
          taken_at?: string
          taken_by_client_id?: string | null
          taken_by_user?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_movements_client_fkey"
            columns: ["organization_id", "taken_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "key_movements_key_fkey"
            columns: ["organization_id", "key_id"]
            isOneToOne: false
            referencedRelation: "keys"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "key_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          location: string | null
          notes: string | null
          organization_id: string
          property_id: string
          status: Database["public"]["Enums"]["key_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          location?: string | null
          notes?: string | null
          organization_id: string
          property_id: string
          status?: Database["public"]["Enums"]["key_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          location?: string | null
          notes?: string | null
          organization_id?: string
          property_id?: string
          status?: Database["public"]["Enums"]["key_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keys_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      landing_pages: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          lead_assignee_id: string | null
          name: string
          organization_id: string
          property_ids: string[]
          published_at: string | null
          seo: Json
          slug: string
          status: Database["public"]["Enums"]["landing_status"]
          template: Database["public"]["Enums"]["landing_template"]
          theme: Json
          tracking: Json
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          lead_assignee_id?: string | null
          name: string
          organization_id: string
          property_ids?: string[]
          published_at?: string | null
          seo?: Json
          slug: string
          status?: Database["public"]["Enums"]["landing_status"]
          template: Database["public"]["Enums"]["landing_template"]
          theme?: Json
          tracking?: Json
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          lead_assignee_id?: string | null
          name?: string
          organization_id?: string
          property_ids?: string[]
          published_at?: string | null
          seo?: Json
          slug?: string
          status?: Database["public"]["Enums"]["landing_status"]
          template?: Database["public"]["Enums"]["landing_template"]
          theme?: Json
          tracking?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignment_events: {
        Row: {
          changed_by: string | null
          created_at: string
          from_user_id: string | null
          id: number
          lead_id: string
          organization_id: string
          reason: string
          to_user_id: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: never
          lead_id: string
          organization_id: string
          reason?: string
          to_user_id?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: never
          lead_id?: string
          organization_id?: string
          reason?: string
          to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignment_events_lead_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_assignment_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_contact_events: {
        Row: {
          channel: Database["public"]["Enums"]["lead_contact_channel"]
          created_at: string
          created_by: string | null
          id: number
          lead_id: string
          organization_id: string
          reached: boolean
        }
        Insert: {
          channel: Database["public"]["Enums"]["lead_contact_channel"]
          created_at?: string
          created_by?: string | null
          id?: never
          lead_id: string
          organization_id: string
          reached: boolean
        }
        Update: {
          channel?: Database["public"]["Enums"]["lead_contact_channel"]
          created_at?: string
          created_by?: string | null
          id?: never
          lead_id?: string
          organization_id?: string
          reached?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lead_contact_events_lead_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_contact_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_integration_deliveries: {
        Row: {
          attempts: number
          contact_name: string | null
          detail: string | null
          external_event_id: string
          id: string
          lead_id: string | null
          listing_code: string | null
          next_attempt_at: string | null
          occurred_at: string | null
          organization_id: string
          origin: string | null
          provider: Database["public"]["Enums"]["lead_integration_provider"]
          reason: string | null
          received_at: string
          settled_at: string | null
          status: Database["public"]["Enums"]["lead_delivery_status"]
        }
        Insert: {
          attempts?: number
          contact_name?: string | null
          detail?: string | null
          external_event_id: string
          id?: string
          lead_id?: string | null
          listing_code?: string | null
          next_attempt_at?: string | null
          occurred_at?: string | null
          organization_id: string
          origin?: string | null
          provider: Database["public"]["Enums"]["lead_integration_provider"]
          reason?: string | null
          received_at?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["lead_delivery_status"]
        }
        Update: {
          attempts?: number
          contact_name?: string | null
          detail?: string | null
          external_event_id?: string
          id?: string
          lead_id?: string | null
          listing_code?: string | null
          next_attempt_at?: string | null
          occurred_at?: string | null
          organization_id?: string
          origin?: string | null
          provider?: Database["public"]["Enums"]["lead_integration_provider"]
          reason?: string | null
          received_at?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["lead_delivery_status"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_integration_deliveries_lead_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_integration_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_integrations: {
        Row: {
          account_label: string | null
          config: Json
          connected_at: string | null
          connected_by: string | null
          created_at: string
          external_account_id: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          last_event_at: string | null
          last_success_at: string | null
          last_test_at: string | null
          organization_id: string
          poll_cursor: Json
          provider: Database["public"]["Enums"]["lead_integration_provider"]
          secret_id: string | null
          status: Database["public"]["Enums"]["lead_integration_status"]
          updated_at: string
          webhook_token: string | null
        }
        Insert: {
          account_label?: string | null
          config?: Json
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_event_at?: string | null
          last_success_at?: string | null
          last_test_at?: string | null
          organization_id: string
          poll_cursor?: Json
          provider: Database["public"]["Enums"]["lead_integration_provider"]
          secret_id?: string | null
          status?: Database["public"]["Enums"]["lead_integration_status"]
          updated_at?: string
          webhook_token?: string | null
        }
        Update: {
          account_label?: string | null
          config?: Json
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_event_at?: string | null
          last_success_at?: string | null
          last_test_at?: string | null
          organization_id?: string
          poll_cursor?: Json
          provider?: Database["public"]["Enums"]["lead_integration_provider"]
          secret_id?: string | null
          status?: Database["public"]["Enums"]["lead_integration_status"]
          updated_at?: string
          webhook_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_routing_members: {
        Row: {
          active: boolean
          away_from: string | null
          away_until: string | null
          created_at: string
          daily_limit: number | null
          id: string
          last_assigned_at: string | null
          organization_id: string
          updated_at: string
          user_id: string
          weight: number
        }
        Insert: {
          active?: boolean
          away_from?: string | null
          away_until?: string | null
          created_at?: string
          daily_limit?: number | null
          id?: string
          last_assigned_at?: string | null
          organization_id: string
          updated_at?: string
          user_id: string
          weight?: number
        }
        Update: {
          active?: boolean
          away_from?: string | null
          away_until?: string | null
          created_at?: string
          daily_limit?: number | null
          id?: string
          last_assigned_at?: string | null
          organization_id?: string
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_routing_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_routing_settings: {
        Row: {
          created_at: string
          fallback_to_page_assignee: boolean
          max_reassignments: number
          organization_id: string
          respect_schedule: boolean
          roulette_enabled: boolean
          sla_minutes: number
          sla_reassign_enabled: boolean
          sla_warning_percent: number
          time_zone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fallback_to_page_assignee?: boolean
          max_reassignments?: number
          organization_id: string
          respect_schedule?: boolean
          roulette_enabled?: boolean
          sla_minutes?: number
          sla_reassign_enabled?: boolean
          sla_warning_percent?: number
          time_zone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fallback_to_page_assignee?: boolean
          max_reassignments?: number
          organization_id?: string
          respect_schedule?: boolean
          roulette_enabled?: boolean
          sla_minutes?: number
          sla_reassign_enabled?: boolean
          sla_warning_percent?: number
          time_zone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_routing_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_routing_shifts: {
        Row: {
          created_at: string
          end_minute: number
          id: string
          member_id: string
          organization_id: string
          start_minute: number
          weekday: number
        }
        Insert: {
          created_at?: string
          end_minute: number
          id?: string
          member_id: string
          organization_id: string
          start_minute: number
          weekday: number
        }
        Update: {
          created_at?: string
          end_minute?: number
          id?: string
          member_id?: string
          organization_id?: string
          start_minute?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_routing_shifts_member_fkey"
            columns: ["organization_id", "member_id"]
            isOneToOne: false
            referencedRelation: "lead_routing_members"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_routing_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_stage_events: {
        Row: {
          changed_by: string | null
          created_at: string
          from_stage: Database["public"]["Enums"]["lead_stage"] | null
          id: number
          lead_id: string
          organization_id: string
          reason: string | null
          to_stage: Database["public"]["Enums"]["lead_stage"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["lead_stage"] | null
          id?: never
          lead_id: string
          organization_id: string
          reason?: string | null
          to_stage: Database["public"]["Enums"]["lead_stage"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["lead_stage"] | null
          id?: never
          lead_id?: string
          organization_id?: string
          reason?: string | null
          to_stage?: Database["public"]["Enums"]["lead_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_stage_events_lead_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_stage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          click_ids: Json
          client_id: string | null
          consent_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          event_id: string | null
          first_contact_at: string | null
          first_response_due_at: string | null
          id: string
          import_job_id: string | null
          imported_at: string | null
          interest: string | null
          landing_page_id: string | null
          landing_url: string | null
          last_contact_at: string | null
          lost_reason: string | null
          message: string | null
          name: string
          organization_id: string
          phone: string | null
          position: number | null
          property_id: string | null
          referrer: string | null
          routing_due_at: string | null
          sla_breached_at: string | null
          sla_reassignments: number
          sla_warned_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["lead_stage"]
          typology: string | null
          updated_at: string
          utm: Json
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          click_ids?: Json
          client_id?: string | null
          consent_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          event_id?: string | null
          first_contact_at?: string | null
          first_response_due_at?: string | null
          id?: string
          import_job_id?: string | null
          imported_at?: string | null
          interest?: string | null
          landing_page_id?: string | null
          landing_url?: string | null
          last_contact_at?: string | null
          lost_reason?: string | null
          message?: string | null
          name: string
          organization_id: string
          phone?: string | null
          position?: number | null
          property_id?: string | null
          referrer?: string | null
          routing_due_at?: string | null
          sla_breached_at?: string | null
          sla_reassignments?: number
          sla_warned_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          typology?: string | null
          updated_at?: string
          utm?: Json
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          click_ids?: Json
          client_id?: string | null
          consent_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          event_id?: string | null
          first_contact_at?: string | null
          first_response_due_at?: string | null
          id?: string
          import_job_id?: string | null
          imported_at?: string | null
          interest?: string | null
          landing_page_id?: string | null
          landing_url?: string | null
          last_contact_at?: string | null
          lost_reason?: string | null
          message?: string | null
          name?: string
          organization_id?: string
          phone?: string | null
          position?: number | null
          property_id?: string | null
          referrer?: string | null
          routing_due_at?: string | null
          sla_breached_at?: string | null
          sla_reassignments?: number
          sla_warned_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage?: Database["public"]["Enums"]["lead_stage"]
          typology?: string | null
          updated_at?: string
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "leads_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leads_import_job_fkey"
            columns: ["organization_id", "import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leads_landing_page_fkey"
            columns: ["organization_id", "landing_page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      listing_authorizations: {
        Row: {
          commission_percent: number | null
          created_at: string
          created_by: string | null
          document_path: string | null
          ends_on: string | null
          exclusive: boolean
          id: string
          organization_id: string
          owner_client_id: string
          property_id: string
          signed_at: string | null
          starts_on: string
          updated_at: string
        }
        Insert: {
          commission_percent?: number | null
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          ends_on?: string | null
          exclusive?: boolean
          id?: string
          organization_id: string
          owner_client_id: string
          property_id: string
          signed_at?: string | null
          starts_on?: string
          updated_at?: string
        }
        Update: {
          commission_percent?: number | null
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          ends_on?: string | null
          exclusive?: boolean
          id?: string
          organization_id?: string
          owner_client_id?: string
          property_id?: string
          signed_at?: string | null
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_authorizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_authorizations_owner_client_fkey"
            columns: ["organization_id", "owner_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "listing_authorizations_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      listing_publication_settings: {
        Row: {
          created_at: string
          google_tag_id: string | null
          hide_without_valid_authorization: boolean
          meta_pixel_id: string | null
          organization_id: string
          public_pages_enabled_by_default: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          google_tag_id?: string | null
          hide_without_valid_authorization?: boolean
          meta_pixel_id?: string | null
          organization_id: string
          public_pages_enabled_by_default?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          google_tag_id?: string | null
          hide_without_valid_authorization?: boolean
          meta_pixel_id?: string | null
          organization_id?: string
          public_pages_enabled_by_default?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_publication_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_investments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          month: string
          notes: string | null
          organization_id: string
          source: Database["public"]["Enums"]["lead_source"]
          updated_at: string
          updated_by: string | null
          utm_campaign: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          month: string
          notes?: string | null
          organization_id: string
          source: Database["public"]["Enums"]["lead_source"]
          updated_at?: string
          updated_by?: string | null
          utm_campaign?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          month?: string
          notes?: string | null
          organization_id?: string
          source?: Database["public"]["Enums"]["lead_source"]
          updated_at?: string
          updated_by?: string | null
          utm_campaign?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_investments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_permission_settings: {
        Row: {
          created_at: string
          export_roles: Database["public"]["Enums"]["app_role"][]
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          export_roles?: Database["public"]["Enums"]["app_role"][]
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          export_roles?: Database["public"]["Enums"]["app_role"][]
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_permission_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand: Json
          city: string | null
          cnpj: string | null
          created_at: string
          created_by: string | null
          creci: string | null
          email: string | null
          feed_token: string
          id: string
          legal_name: string | null
          name: string
          phone: string | null
          plan: Database["public"]["Enums"]["organization_plan"]
          referral_code: string
          referred_by_organization_id: string | null
          slug: string
          state: string | null
          updated_at: string
        }
        Insert: {
          brand?: Json
          city?: string | null
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          creci?: string | null
          email?: string | null
          feed_token?: string
          id?: string
          legal_name?: string | null
          name: string
          phone?: string | null
          plan?: Database["public"]["Enums"]["organization_plan"]
          referral_code?: string
          referred_by_organization_id?: string | null
          slug: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          brand?: Json
          city?: string | null
          cnpj?: string | null
          created_at?: string
          created_by?: string | null
          creci?: string | null
          email?: string | null
          feed_token?: string
          id?: string
          legal_name?: string | null
          name?: string
          phone?: string | null
          plan?: Database["public"]["Enums"]["organization_plan"]
          referral_code?: string
          referred_by_organization_id?: string | null
          slug?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_referred_by_organization_id_fkey"
            columns: ["referred_by_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_announcement_dismissals: {
        Row: {
          announcement_id: string
          dismissed_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          dismissed_at?: string
          user_id?: string
        }
        Update: {
          announcement_id?: string
          dismissed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_announcement_dismissals_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "platform_announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_announcements: {
        Row: {
          audience: string
          body: string
          created_at: string
          ended_at: string | null
          ends_at: string
          id: string
          kind: string
          link_label: string | null
          link_url: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          audience: string
          body: string
          created_at?: string
          ended_at?: string | null
          ends_at: string
          id?: string
          kind: string
          link_label?: string | null
          link_url?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          body?: string
          created_at?: string
          ended_at?: string | null
          ends_at?: string
          id?: string
          kind?: string
          link_label?: string | null
          link_url?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          creci_number: string | null
          creci_state: string | null
          creci_valid_until: string | null
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          creci_number?: string | null
          creci_state?: string | null
          creci_valid_until?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          creci_number?: string | null
          creci_state?: string | null
          creci_valid_until?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          accepts_exchange: boolean
          accepts_pets: boolean
          address_display: Database["public"]["Enums"]["address_display"]
          anonymized_at: string | null
          bathrooms: number | null
          bedrooms: number | null
          broker_id: string | null
          captured_by: string | null
          city: string | null
          code: string
          complement: string | null
          condo_fee: number | null
          condominium_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          external_code: string | null
          features: string[]
          floor: number | null
          furnished: boolean
          id: string
          imob_score: number | null
          iptu_yearly: number | null
          is_restricted: boolean
          latitude: number | null
          living_area: number | null
          longitude: number | null
          lot_area: number | null
          neighborhood: string | null
          organization_id: string
          parking_spaces: number | null
          postal_code: string | null
          public_page_enabled: boolean | null
          published_at: string | null
          published_to_portals: boolean
          purpose: Database["public"]["Enums"]["listing_purpose"]
          registry_number: string | null
          rent_price: number | null
          sale_price: number | null
          state: string | null
          status: Database["public"]["Enums"]["property_status"]
          street: string | null
          street_number: string | null
          suites: number | null
          title: string
          total_floors: number | null
          type: Database["public"]["Enums"]["property_type"]
          updated_at: string
          usage: Database["public"]["Enums"]["property_usage"]
          year_built: number | null
        }
        Insert: {
          accepts_exchange?: boolean
          accepts_pets?: boolean
          address_display?: Database["public"]["Enums"]["address_display"]
          anonymized_at?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          broker_id?: string | null
          captured_by?: string | null
          city?: string | null
          code?: string
          complement?: string | null
          condo_fee?: number | null
          condominium_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          external_code?: string | null
          features?: string[]
          floor?: number | null
          furnished?: boolean
          id?: string
          imob_score?: number | null
          iptu_yearly?: number | null
          is_restricted?: boolean
          latitude?: number | null
          living_area?: number | null
          longitude?: number | null
          lot_area?: number | null
          neighborhood?: string | null
          organization_id: string
          parking_spaces?: number | null
          postal_code?: string | null
          public_page_enabled?: boolean | null
          published_at?: string | null
          published_to_portals?: boolean
          purpose: Database["public"]["Enums"]["listing_purpose"]
          registry_number?: string | null
          rent_price?: number | null
          sale_price?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          street?: string | null
          street_number?: string | null
          suites?: number | null
          title: string
          total_floors?: number | null
          type: Database["public"]["Enums"]["property_type"]
          updated_at?: string
          usage?: Database["public"]["Enums"]["property_usage"]
          year_built?: number | null
        }
        Update: {
          accepts_exchange?: boolean
          accepts_pets?: boolean
          address_display?: Database["public"]["Enums"]["address_display"]
          anonymized_at?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          broker_id?: string | null
          captured_by?: string | null
          city?: string | null
          code?: string
          complement?: string | null
          condo_fee?: number | null
          condominium_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          external_code?: string | null
          features?: string[]
          floor?: number | null
          furnished?: boolean
          id?: string
          imob_score?: number | null
          iptu_yearly?: number | null
          is_restricted?: boolean
          latitude?: number | null
          living_area?: number | null
          longitude?: number | null
          lot_area?: number | null
          neighborhood?: string | null
          organization_id?: string
          parking_spaces?: number | null
          postal_code?: string | null
          public_page_enabled?: boolean | null
          published_at?: string | null
          published_to_portals?: boolean
          purpose?: Database["public"]["Enums"]["listing_purpose"]
          registry_number?: string | null
          rent_price?: number | null
          sale_price?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          street?: string | null
          street_number?: string | null
          suites?: number | null
          title?: string
          total_floors?: number | null
          type?: Database["public"]["Enums"]["property_type"]
          updated_at?: string
          usage?: Database["public"]["Enums"]["property_usage"]
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_condominium_fkey"
            columns: ["organization_id", "condominium_id"]
            isOneToOne: false
            referencedRelation: "condominiums"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_documents: {
        Row: {
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["property_document_kind"]
          mime_type: string
          organization_id: string
          property_id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["property_document_kind"]
          mime_type: string
          organization_id: string
          property_id: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["property_document_kind"]
          mime_type?: string
          organization_id?: string
          property_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_documents_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      property_media: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          external_url: string | null
          id: string
          is_cover: boolean
          kind: Database["public"]["Enums"]["media_kind"]
          organization_id: string
          position: number
          property_id: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          id?: string
          is_cover?: boolean
          kind: Database["public"]["Enums"]["media_kind"]
          organization_id: string
          position?: number
          property_id: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          id?: string
          is_cover?: boolean
          kind?: Database["public"]["Enums"]["media_kind"]
          organization_id?: string
          position?: number
          property_id?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_media_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_media_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      property_owners: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          property_id: string
          share_percent: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          property_id: string
          share_percent?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          property_id?: string
          share_percent?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_owners_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "property_owners_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_owners_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      property_shares: {
        Row: {
          created_at: string
          created_by: string | null
          organization_id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          organization_id: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          organization_id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_shares_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      proposal_discount_requests: {
        Row: {
          amount_cents: number
          created_at: string
          discount_percent: number
          id: string
          organization_id: string
          proposal_id: string
          reason: string | null
          reference_cents: number
          requested_by: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["discount_request_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          discount_percent: number
          id?: string
          organization_id: string
          proposal_id: string
          reason?: string | null
          reference_cents: number
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["discount_request_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          discount_percent?: number
          id?: string
          organization_id?: string
          proposal_id?: string
          reason?: string | null
          reference_cents?: number
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["discount_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_discount_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_discount_requests_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_rounds: {
        Row: {
          amount: number
          conditions: string | null
          created_at: string
          created_by: string | null
          down_payment: number | null
          exchange_description: string | null
          financing_amount: number | null
          id: string
          kind: Database["public"]["Enums"]["proposal_round_kind"]
          organization_id: string
          payment_deadline: string | null
          payment_terms: string | null
          proposal_id: string
          round_number: number
          valid_until: string | null
        }
        Insert: {
          amount: number
          conditions?: string | null
          created_at?: string
          created_by?: string | null
          down_payment?: number | null
          exchange_description?: string | null
          financing_amount?: number | null
          id?: string
          kind: Database["public"]["Enums"]["proposal_round_kind"]
          organization_id: string
          payment_deadline?: string | null
          payment_terms?: string | null
          proposal_id: string
          round_number: number
          valid_until?: string | null
        }
        Update: {
          amount?: number
          conditions?: string | null
          created_at?: string
          created_by?: string | null
          down_payment?: number | null
          exchange_description?: string | null
          financing_amount?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["proposal_round_kind"]
          organization_id?: string
          payment_deadline?: string | null
          payment_terms?: string | null
          proposal_id?: string
          round_number?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_rounds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_rounds_proposal_fkey"
            columns: ["organization_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      proposal_shares: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          first_viewed_at: string | null
          last_viewed_at: string | null
          organization_id: string
          proposal_id: string
          token: string | null
          updated_at: string
          view_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          first_viewed_at?: string | null
          last_viewed_at?: string | null
          organization_id: string
          proposal_id: string
          token?: string | null
          updated_at?: string
          view_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          first_viewed_at?: string | null
          last_viewed_at?: string | null
          organization_id?: string
          proposal_id?: string
          token?: string | null
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_shares_proposal_fkey"
            columns: ["organization_id", "proposal_id"]
            isOneToOne: true
            referencedRelation: "proposals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      proposal_stage_probabilities: {
        Row: {
          created_at: string
          organization_id: string
          probability: number
          status: Database["public"]["Enums"]["proposal_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          organization_id: string
          probability: number
          status: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          organization_id?: string
          probability?: number
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_stage_probabilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          amount: number
          broker_id: string | null
          client_id: string
          conditions: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          down_payment: number | null
          exchange_description: string | null
          expected_close_date: string | null
          financing_amount: number | null
          id: string
          organization_id: string
          payment_deadline: string | null
          payment_terms: string | null
          property_id: string
          purpose: Database["public"]["Enums"]["listing_purpose"]
          round_kind: Database["public"]["Enums"]["proposal_round_kind"]
          round_number: number
          status: Database["public"]["Enums"]["proposal_status"]
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          amount: number
          broker_id?: string | null
          client_id: string
          conditions?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          down_payment?: number | null
          exchange_description?: string | null
          expected_close_date?: string | null
          financing_amount?: number | null
          id?: string
          organization_id: string
          payment_deadline?: string | null
          payment_terms?: string | null
          property_id: string
          purpose: Database["public"]["Enums"]["listing_purpose"]
          round_kind?: Database["public"]["Enums"]["proposal_round_kind"]
          round_number?: number
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          amount?: number
          broker_id?: string | null
          client_id?: string
          conditions?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          down_payment?: number | null
          exchange_description?: string | null
          expected_close_date?: string | null
          financing_amount?: number | null
          id?: string
          organization_id?: string
          payment_deadline?: string | null
          payment_terms?: string | null
          property_id?: string
          purpose?: Database["public"]["Enums"]["listing_purpose"]
          round_kind?: Database["public"]["Enums"]["proposal_round_kind"]
          round_number?: number
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_secret: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          last_delivered_at: string | null
          last_seen_at: string
          organization_id: string | null
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_secret: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          last_delivered_at?: string | null
          last_seen_at?: string
          organization_id?: string | null
          p256dh: string
          user_id: string
        }
        Update: {
          auth_secret?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          last_delivered_at?: string | null
          last_seen_at?: string
          organization_id?: string | null
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_goals: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          leads_answered: number | null
          month: string
          organization_id: string
          proposals: number | null
          rentals_amount: number | null
          rentals_count: number | null
          sales_amount: number | null
          sales_count: number | null
          team_id: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
          visits: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          leads_answered?: number | null
          month: string
          organization_id: string
          proposals?: number | null
          rentals_amount?: number | null
          rentals_count?: number | null
          sales_amount?: number | null
          sales_count?: number | null
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          visits?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          leads_answered?: number | null
          month?: string
          organization_id?: string
          proposals?: number | null
          rentals_amount?: number | null
          rentals_count?: number | null
          sales_amount?: number | null
          sales_count?: number | null
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          visits?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_goals_member_fkey"
            columns: ["user_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["user_id", "organization_id"]
          },
          {
            foreignKeyName: "sales_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_goals_team_fkey"
            columns: ["organization_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          organization_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          property_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          organization_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          property_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          organization_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          property_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_fkey"
            columns: ["organization_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          created_by: string | null
          organization_id: string
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          organization_id: string
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          organization_id?: string
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_membership_fkey"
            columns: ["user_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["user_id", "organization_id"]
          },
          {
            foreignKeyName: "team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_fkey"
            columns: ["organization_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          leader_id: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          leader_id?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          leader_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_leader_fkey"
            columns: ["leader_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["user_id", "organization_id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_channels: {
        Row: {
          auto_suspended_at: string | null
          auto_suspended_reason: string | null
          connected_account_id: string
          created_at: string
          display_phone_number: string | null
          enabled: boolean
          id: string
          last_quality_change_at: string | null
          last_synced_at: string | null
          messaging_tier: string
          organization_id: string
          phone_number_id: string
          quality_rating: Database["public"]["Enums"]["whatsapp_quality_rating"]
          throughput: number | null
          updated_at: string
          verified_name: string | null
          waba_id: string
        }
        Insert: {
          auto_suspended_at?: string | null
          auto_suspended_reason?: string | null
          connected_account_id: string
          created_at?: string
          display_phone_number?: string | null
          enabled?: boolean
          id?: string
          last_quality_change_at?: string | null
          last_synced_at?: string | null
          messaging_tier?: string
          organization_id: string
          phone_number_id: string
          quality_rating?: Database["public"]["Enums"]["whatsapp_quality_rating"]
          throughput?: number | null
          updated_at?: string
          verified_name?: string | null
          waba_id: string
        }
        Update: {
          auto_suspended_at?: string | null
          auto_suspended_reason?: string | null
          connected_account_id?: string
          created_at?: string
          display_phone_number?: string | null
          enabled?: boolean
          id?: string
          last_quality_change_at?: string | null
          last_synced_at?: string | null
          messaging_tier?: string
          organization_id?: string
          phone_number_id?: string
          quality_rating?: Database["public"]["Enums"]["whatsapp_quality_rating"]
          throughput?: number | null
          updated_at?: string
          verified_name?: string | null
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_channels_account_fkey"
            columns: ["organization_id", "connected_account_id"]
            isOneToOne: false
            referencedRelation: "connected_accounts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "whatsapp_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          assigned_to: string | null
          channel_id: string
          client_id: string | null
          closed_at: string | null
          contact_name: string | null
          contact_wa_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          lead_id: string | null
          organization_id: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          channel_id: string
          client_id?: string | null
          closed_at?: string | null
          contact_name?: string | null
          contact_wa_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          organization_id: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          channel_id?: string
          client_id?: string | null
          closed_at?: string | null
          contact_name?: string | null
          contact_wa_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          organization_id?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_channel_fkey"
            columns: ["organization_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_channels"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_lead_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          accepted_at: string | null
          body: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code: number | null
          error_title: string | null
          failed_at: string | null
          id: string
          media: Json
          organization_id: string
          pricing_category: string | null
          pricing_type: string | null
          read_at: string | null
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["whatsapp_message_status"]
          template_name: string | null
          wamid: string | null
        }
        Insert: {
          accepted_at?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code?: number | null
          error_title?: string | null
          failed_at?: string | null
          id?: string
          media?: Json
          organization_id: string
          pricing_category?: string | null
          pricing_type?: string | null
          read_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status: Database["public"]["Enums"]["whatsapp_message_status"]
          template_name?: string | null
          wamid?: string | null
        }
        Update: {
          accepted_at?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["whatsapp_message_direction"]
          error_code?: number | null
          error_title?: string | null
          failed_at?: string | null
          id?: string
          media?: Json
          organization_id?: string
          pricing_category?: string | null
          pricing_type?: string | null
          read_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["whatsapp_message_status"]
          template_name?: string | null
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "whatsapp_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_suppressions: {
        Row: {
          contact_wa_id: string
          created_at: string
          created_by: string | null
          evidence: Json
          id: string
          organization_id: string
          reason: string | null
          released_at: string | null
          released_by: string | null
          released_consent_id: string | null
          released_reason: string | null
          scope: Database["public"]["Enums"]["whatsapp_suppression_scope"]
          source: Database["public"]["Enums"]["whatsapp_suppression_source"]
        }
        Insert: {
          contact_wa_id: string
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          organization_id: string
          reason?: string | null
          released_at?: string | null
          released_by?: string | null
          released_consent_id?: string | null
          released_reason?: string | null
          scope?: Database["public"]["Enums"]["whatsapp_suppression_scope"]
          source: Database["public"]["Enums"]["whatsapp_suppression_source"]
        }
        Update: {
          contact_wa_id?: string
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          organization_id?: string
          reason?: string | null
          released_at?: string | null
          released_by?: string | null
          released_consent_id?: string | null
          released_reason?: string | null
          scope?: Database["public"]["Enums"]["whatsapp_suppression_scope"]
          source?: Database["public"]["Enums"]["whatsapp_suppression_source"]
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_suppressions_consent_fkey"
            columns: ["organization_id", "released_consent_id"]
            isOneToOne: false
            referencedRelation: "consent_records"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "whatsapp_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      client_property_matches: {
        Row: {
          bedrooms: number | null
          city: string | null
          client_assigned_to: string | null
          client_id: string | null
          client_interest_id: string | null
          client_name: string | null
          imob_score: number | null
          interest_purpose:
            | Database["public"]["Enums"]["listing_purpose"]
            | null
          neighborhood: string | null
          organization_id: string | null
          parking_spaces: number | null
          property_code: string | null
          property_id: string | null
          property_purpose:
            | Database["public"]["Enums"]["listing_purpose"]
            | null
          property_title: string | null
          property_type: Database["public"]["Enums"]["property_type"] | null
          rent_price: number | null
          sale_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_interests_client_fkey"
            columns: ["organization_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "client_interests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_connection_terms: {
        Args: {
          p_displayed_text: string
          p_ip_hash?: string
          p_organization_id: string
          p_provider: Database["public"]["Enums"]["connection_provider"]
          p_provider_evidence?: Json
          p_terms_key: string
          p_terms_url: string
          p_terms_version: string
          p_user_agent?: string
        }
        Returns: string
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      add_whatsapp_suppression: {
        Args: {
          p_contact: string
          p_organization_id: string
          p_reason?: string
          p_scope?: Database["public"]["Enums"]["whatsapp_suppression_scope"]
        }
        Returns: string
      }
      anonymize_from_trash: {
        Args: { p_confirmation: string; p_entity: string; p_record_id: string }
        Returns: Json
      }
      apply_referral_recalculation: {
        Args: {
          p_count?: string[]
          p_expected_fingerprint?: string
          p_expected_percent?: number
          p_organization_id?: string
          p_percent?: number
          p_server_key?: string
          p_uncount?: string[]
        }
        Returns: Json
      }
      assign_lead_from_roulette: {
        Args: { p_lead_id: string; p_organization_id: string }
        Returns: Json
      }
      bulk_reassign_leads: {
        Args: {
          p_from_user_id: string
          p_include_closed?: boolean
          p_organization_id: string
          p_to_user_id?: string
        }
        Returns: Json
      }
      caixa_catalog_facets: { Args: { p_uf?: string }; Returns: Json }
      public_caixa_catalog_facets: { Args: { p_uf?: string }; Returns: Json }
      public_get_caixa_listing: {
        Args: { p_numero: string }
        Returns: {
          aceita_financiamento: boolean | null
          area_privativa: number | null
          area_terreno: number | null
          area_total: number | null
          bairro: string | null
          cidade: string
          desconto: number | null
          descricao: string | null
          endereco: string
          lista_gerada_em: string | null
          link: string
          modalidade: string | null
          numero: string
          preco: number
          quartos: number | null
          tipo: Database["public"]["Enums"]["property_type"]
          uf: string
          vagas: number | null
          valor_avaliacao: number | null
        }[]
      }
      public_search_caixa_listings: {
        Args: {
          p_bairro?: string
          p_cidade?: string
          p_financiamento?: boolean
          p_limit?: number
          p_max_price?: number
          p_min_desconto?: number
          p_min_price?: number
          p_modalidade?: string
          p_offset?: number
          p_sort?: string
          p_term?: string
          p_tipo?: Database["public"]["Enums"]["property_type"]
          p_uf?: string
        }
        Returns: {
          aceita_financiamento: boolean | null
          area_privativa: number | null
          area_terreno: number | null
          area_total: number | null
          bairro: string | null
          cidade: string
          desconto: number | null
          descricao: string | null
          endereco: string
          lista_gerada_em: string | null
          link: string
          modalidade: string | null
          numero: string
          preco: number
          quartos: number | null
          tipo: Database["public"]["Enums"]["property_type"]
          uf: string
          vagas: number | null
          valor_avaliacao: number | null
          total_count: number
        }[]
      }
      cancel_organization_deletion: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      claim_authorization_alerts: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: {
          brand_color: string
          days_left: number
          ends_on: string
          exclusive: boolean
          id: string
          milestone: number
          organization_id: string
          organization_name: string
          organization_slug: string
          property_city: string
          property_code: string
          property_id: string
          property_neighborhood: string
          property_state: string
          property_title: string
          recipient_email: string
          recipient_is_manager: boolean
          recipient_name: string
          recipient_user_id: string
        }[]
      }
      claim_daily_digests: {
        Args: {
          p_limit?: number
          p_organization_id?: string
          p_server_key: string
          p_stale_days?: number
        }
        Returns: {
          brand_color: string
          content: Json
          digest_date: string
          id: string
          organization_id: string
          organization_name: string
          organization_slug: string
          recipient_email: string
          recipient_name: string
          recipient_user_id: string
        }[]
      }
      claim_lead_deliveries: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: {
          attempts: number
          external_account_id: string
          external_event_id: string
          organization_id: string
          provider: string
        }[]
      }
      claim_lead_notification_pushes: {
        Args: { p_notification_ids: string[]; p_server_key: string }
        Returns: {
          auth_secret: string
          endpoint: string
          notification_id: string
          p256dh: string
          subscription_id: string
        }[]
      }
      claim_lead_notifications: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: {
          due_at: string
          id: string
          kind: string
          lead_created_at: string
          lead_id: string
          lead_interest: string
          lead_name: string
          lead_phone: string
          lead_source: string
          organization_id: string
          organization_slug: string
          recipient_email: string
          recipient_name: string
          sla_minutes: number
        }[]
      }
      claim_organization_storage_objects: {
        Args: { p_limit: number; p_server_key: string }
        Returns: {
          bucket_id: string
          object_path: string
        }[]
      }
      claim_task_reminders: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: {
          due_at: string
          id: string
          organization_id: string
          organization_slug: string
          push_targets: Json
          recipient_user_id: string
          task_id: string
          task_title: string
        }[]
      }
      claim_visit_assignment_notices: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: {
          address_display: Database["public"]["Enums"]["address_display"]
          appointment_id: string
          appointment_status: Database["public"]["Enums"]["appointment_status"]
          assigned_by_name: string
          brand_color: string
          city: string
          client_first_name: string
          ends_at: string
          id: string
          meeting_point: string
          neighborhood: string
          organization_id: string
          organization_name: string
          organization_slug: string
          property_code: string
          property_id: string
          property_title: string
          push_targets: Json
          recipient_email: string
          recipient_name: string
          recipient_user_id: string
          starts_at: string
          state: string
          street: string
          street_number: string
        }[]
      }
      claim_visit_reminders: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: {
          address_display: Database["public"]["Enums"]["address_display"]
          appointment_id: string
          appointment_status: Database["public"]["Enums"]["appointment_status"]
          brand_color: string
          city: string
          client_first_name: string
          ends_at: string
          id: string
          meeting_point: string
          neighborhood: string
          organization_id: string
          organization_name: string
          organization_slug: string
          property_code: string
          property_id: string
          property_title: string
          recipient_email: string
          recipient_name: string
          recipient_user_id: string
          starts_at: string
          state: string
          street: string
          street_number: string
        }[]
      }
      claim_weekly_reports: {
        Args: {
          p_limit?: number
          p_organization_id?: string
          p_server_key: string
        }
        Returns: {
          brand_color: string
          id: string
          organization_id: string
          organization_name: string
          organization_slug: string
          recipient_email: string
          recipient_name: string
          recipient_user_id: string
          report: Json
          week_end: string
          week_start: string
        }[]
      }
      commission_summary: { Args: { p_user_id?: string }; Returns: Json }
      connect_connection_account: {
        Args: {
          p_connected_by?: string
          p_display_name?: string
          p_external_account_id?: string
          p_external_owner_id?: string
          p_handle?: string
          p_metadata?: Json
          p_nonce?: string
          p_organization_id?: string
          p_provider?: Database["public"]["Enums"]["connection_provider"]
          p_scopes?: string[]
          p_server_key?: string
          p_terms_acceptance_id?: string
          p_token?: string
          p_token_expires_at?: string
        }
        Returns: Json
      }
      connect_lead_integration: {
        Args: {
          p_account_label?: string
          p_config?: Json
          p_credential: string
          p_external_account_id: string
          p_organization_id: string
          p_provider: string
        }
        Returns: undefined
      }
      copy_sales_goals: {
        Args: {
          p_from_month: string
          p_organization_id: string
          p_to_month: string
        }
        Returns: number
      }
      create_organization: {
        Args: {
          p_city?: string
          p_cnpj?: string
          p_creci?: string
          p_legal_name?: string
          p_name: string
          p_referral_code?: string
          p_slug: string
          p_state?: string
        }
        Returns: string
      }
      dashboard_authorization_alerts: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      dashboard_client_birthdays: {
        Args: { p_days?: number; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      dashboard_leads_by_stage: {
        Args: { p_days?: number; p_organization_id: string }
        Returns: {
          stage: Database["public"]["Enums"]["lead_stage"]
          total: number
        }[]
      }
      dashboard_leads_by_week: {
        Args: { p_organization_id: string; p_weeks?: number }
        Returns: {
          source: Database["public"]["Enums"]["lead_source"]
          total: number
          week_start: string
        }[]
      }
      dashboard_properties_by_status: {
        Args: { p_organization_id: string }
        Returns: {
          rent_value: number
          sale_value: number
          status: Database["public"]["Enums"]["property_status"]
          total: number
        }[]
      }
      dashboard_undelivered_emails: {
        Args: { p_organization_id: string }
        Returns: {
          kind: string
          notices: number
          priority: number
          reason: string
        }[]
      }
      delete_my_account: { Args: { p_confirmation: string }; Returns: Json }
      disconnect_connection: {
        Args: { p_connected_account_id: string }
        Returns: Json
      }
      disconnect_lead_integration: {
        Args: { p_organization_id: string; p_provider: string }
        Returns: undefined
      }
      enable_lead_webhook: {
        Args: {
          p_account_label?: string
          p_organization_id: string
          p_provider: string
          p_rotate?: boolean
        }
        Returns: string
      }
      erase_subject_data: {
        Args: { p_confirmation: string; p_entity: string; p_record_id: string }
        Returns: Json
      }
      export_clients_rows: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_export_id: string
          p_from?: string
          p_limit?: number
          p_organization_id: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          assigned_to_name: string
          birth_date: string
          city: string
          created_at: string
          document: string
          email: string
          id: string
          kind: Database["public"]["Enums"]["client_kind"]
          lgpd_consent_at: string
          name: string
          neighborhood: string
          phone: string
          source: string
          state: string
          tags: string[]
          whatsapp: string
        }[]
      }
      export_leads_rows: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_export_id: string
          p_from?: string
          p_limit?: number
          p_organization_id: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          assigned_at: string
          assigned_to_name: string
          created_at: string
          email: string
          first_contact_at: string
          id: string
          interest: string
          landing_page_name: string
          lost_reason: string
          name: string
          phone: string
          source: Database["public"]["Enums"]["lead_source"]
          stage: Database["public"]["Enums"]["lead_stage"]
          tracking_ids: string
          utm_campaign: string
          utm_medium: string
          utm_source: string
        }[]
      }
      export_properties_rows: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_export_id: string
          p_from?: string
          p_limit?: number
          p_organization_id: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          bedrooms: number
          broker_name: string
          captured_by_name: string
          city: string
          code: string
          condo_fee: number
          created_at: string
          id: string
          imob_score: number
          living_area: number
          neighborhood: string
          parking_spaces: number
          published_to_portals: boolean
          purpose: Database["public"]["Enums"]["listing_purpose"]
          rent_price: number
          sale_price: number
          state: string
          status: Database["public"]["Enums"]["property_status"]
          title: string
          type: Database["public"]["Enums"]["property_type"]
        }[]
      }
      export_proposals_rows: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_export_id: string
          p_from?: string
          p_limit?: number
          p_organization_id: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          amount: number
          broker_name: string
          client_name: string
          created_at: string
          decided_at: string
          id: string
          property_code: string
          property_title: string
          purpose: Database["public"]["Enums"]["listing_purpose"]
          status: Database["public"]["Enums"]["proposal_status"]
          valid_until: string
        }[]
      }
      fail_lead_delivery: {
        Args: {
          p_detail?: string
          p_external_event_id: string
          p_organization_id: string
          p_provider: string
          p_reason: string
          p_server_key: string
        }
        Returns: Json
      }
      finish_caixa_sync: {
        Args: {
          p_generated_on?: string
          p_origem?: string
          p_rejected?: number
          p_server_key: string
          p_source_digest?: string
          p_source_etag?: string
          p_source_last_modified?: string
          p_sync_id: string
        }
        Returns: Json
      }
      get_ai_usage_overview: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_billing_account_ids: {
        Args: { p_organization_id?: string; p_server_key?: string }
        Returns: {
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
        }[]
      }
      get_billing_overview: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_caixa_sync_state: { Args: { p_server_key: string }; Returns: Json }
      get_connection_credential: {
        Args: { p_connected_account_id?: string; p_server_key?: string }
        Returns: Json
      }
      get_consent_state: {
        Args: {
          p_address: string
          p_channel: Database["public"]["Enums"]["consent_channel"]
          p_organization_id: string
        }
        Returns: Json
      }
      get_feed_settings: { Args: { p_organization_id: string }; Returns: Json }
      get_invitation_preview: { Args: { p_token: string }; Returns: Json }
      get_lead_integrations_overview: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      get_lead_routing_overview: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_lead_stage_metrics: {
        Args: { p_days?: number; p_organization_id: string }
        Returns: Json
      }
      get_my_account_deletion_blockers: {
        Args: never
        Returns: {
          organization_id: string
          organization_name: string
        }[]
      }
      get_notification_recipients: {
        Args: {
          p_kind: string
          p_organization_id: string
          p_server_key: string
          p_subject_id: string
        }
        Returns: {
          email: string
          full_name: string
        }[]
      }
      get_organization_deletion: {
        Args: { p_organization_id: string }
        Returns: {
          execute_after: string
          requested_at: string
          requested_by_name: string
          scheduled: boolean
          subscription_renews: boolean
        }[]
      }
      get_owned_listing_usage: {
        Args: { p_organization_id: string }
        Returns: number
      }
      get_portal_feed: {
        Args: { p_org_slug: string; p_token: string }
        Returns: Json
      }
      get_proposal_document: { Args: { p_proposal_id: string }; Returns: Json }
      get_proposal_stage_probabilities: {
        Args: { p_organization_id: string }
        Returns: {
          is_default: boolean
          probability: number
          status: Database["public"]["Enums"]["proposal_status"]
        }[]
      }
      get_public_landing_page: {
        Args: { p_org_slug: string; p_page_slug: string }
        Returns: Json
      }
      get_public_organization: { Args: { p_slug: string }; Returns: Json }
      get_public_property: {
        Args: { p_code: string; p_org_slug: string }
        Returns: Json
      }
      get_public_sitemap: { Args: { p_org_slug: string }; Returns: Json }
      get_public_status: { Args: never; Returns: Json }
      get_referral_state: {
        Args: { p_organization_id?: string; p_server_key?: string }
        Returns: Json
      }
      get_shared_proposal: { Args: { p_token: string }; Returns: Json }
      import_batch: {
        Args: {
          p_batch_index: number
          p_job_id: string
          p_organization_id: string
          p_rows: Json
        }
        Returns: Json
      }
      import_find_existing: {
        Args: {
          p_kind: Database["public"]["Enums"]["import_kind"]
          p_organization_id: string
          p_rows: Json
        }
        Returns: Json
      }
      import_finish: {
        Args: {
          p_file_duplicates?: number
          p_invalid_rows?: number
          p_job_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      import_marketing_investments: {
        Args: { p_organization_id: string; p_rows: Json }
        Returns: number
      }
      import_photos_claim: {
        Args: { p_job_id: string; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      import_photos_complete: {
        Args: {
          p_error_code?: string
          p_item_id: string
          p_job_id: string
          p_organization_id: string
          p_storage_path?: string
        }
        Returns: Json
      }
      import_photos_status: {
        Args: { p_job_id: string; p_organization_id: string }
        Returns: Json
      }
      import_start: {
        Args: {
          p_duplicate_mode: Database["public"]["Enums"]["import_duplicate_mode"]
          p_job_id: string
          p_kind: Database["public"]["Enums"]["import_kind"]
          p_options?: Json
          p_organization_id: string
          p_total_rows: number
        }
        Returns: string
      }
      import_undo_apply: {
        Args: { p_job_id: string; p_organization_id: string }
        Returns: Json
      }
      import_undo_prepare: {
        Args: { p_job_id: string; p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      ingest_caixa_listings: {
        Args: {
          p_generated_on?: string
          p_rows?: Json
          p_server_key: string
          p_sync_id: string
        }
        Returns: Json
      }
      ingest_external_lead: {
        Args: {
          p_organization_id: string
          p_payload: Json
          p_provider: string
          p_server_key: string
        }
        Returns: Json
      }
      ingest_webhook_lead: {
        Args: { p_payload: Json; p_server_key: string; p_token: string }
        Returns: Json
      }
      ingest_whatsapp_message: {
        Args: {
          p_body?: string
          p_contact_name?: string
          p_contact_wa_id?: string
          p_media?: Json
          p_phone_number_id?: string
          p_sent_at?: string
          p_server_key?: string
          p_wamid?: string
        }
        Returns: Json
      }
      lead_duplicate_flags: {
        Args: { p_lead_ids: string[] }
        Returns: {
          has_duplicate: boolean
          lead_id: string
        }[]
      }
      list_billing_reminders: {
        Args: { p_kind?: string; p_server_key?: string }
        Returns: {
          notice_date: string
          organization_id: string
          organization_name: string
          organization_slug: string
          owner_emails: string[]
        }[]
      }
      list_lead_campaigns: {
        Args: { p_organization_id: string; p_since?: string }
        Returns: {
          leads: number
          source: Database["public"]["Enums"]["lead_source"]
          utm_campaign: string
        }[]
      }
      list_lead_integrations_for_poll: {
        Args: { p_limit?: number; p_provider: string; p_server_key: string }
        Returns: {
          external_account_id: string
          last_success_at: string
          organization_id: string
          poll_cursor: Json
        }[]
      }
      list_organization_deletion_reminders: {
        Args: { p_limit: number; p_server_key: string }
        Returns: {
          brand_color: string
          execute_after: string
          organization_id: string
          organization_name: string
          organization_slug: string
          recipient_emails: string[]
        }[]
      }
      list_proposal_discount_requests: {
        Args: { p_organization_id: string; p_proposal_ids: string[] }
        Returns: {
          amount_cents: number
          created_at: string
          discount_percent: number
          id: string
          proposal_id: string
          reason: string
          reference_cents: number
          requested_by_me: boolean
          review_note: string
          reviewed_at: string
          status: Database["public"]["Enums"]["discount_request_status"]
          updated_at: string
        }[]
      }
      list_referral_grace_completions: {
        Args: {
          p_cursor_organization_id?: string
          p_cursor_paid_at?: string
          p_limit?: number
          p_paid_after?: string
          p_paid_until?: string
          p_server_key?: string
        }
        Returns: {
          first_paid_at: string
          referred_organization_id: string
          referrer_organization_id: string
        }[]
      }
      list_referral_referrers: {
        Args: {
          p_after?: string
          p_limit?: number
          p_seed?: string
          p_server_key?: string
        }
        Returns: {
          organization_id: string
          sort_key: string
        }[]
      }
      list_storage_purge_queue: {
        Args: { p_limit: number; p_organization_id: string }
        Returns: {
          bucket_id: string
          object_path: string
        }[]
      }
      list_trash: {
        Args: { p_organization_id: string }
        Returns: {
          anonymized_at: string
          code: string
          deleted_at: string
          deleted_by_name: string
          entity: string
          identification_kept_until: string
          label: string
          legal_holds: string[]
          purge_after: string
          record_id: string
        }[]
      }
      log_access_event: {
        Args: { p_action?: string; p_entity: string; p_entity_id: string }
        Returns: undefined
      }
      mark_organization_deletion_reminded: {
        Args: { p_organization_id: string; p_server_key: string }
        Returns: boolean
      }
      mark_whatsapp_message_sent: {
        Args: {
          p_error_code?: number
          p_error_title?: string
          p_message_id?: string
          p_message_status?: string
          p_server_key?: string
          p_wamid?: string
        }
        Returns: Json
      }
      move_to_trash: {
        Args: { p_entity: string; p_record_id: string }
        Returns: undefined
      }
      platform_ai_costs: { Args: { p_server_key: string }; Returns: Json }
      platform_audit_event_filters: {
        Args: { p_server_key: string }
        Returns: Json
      }
      platform_email_quota: { Args: { p_server_key: string }; Returns: Json }
      platform_end_announcement: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_id: string
          p_reason?: string
          p_server_key: string
        }
        Returns: string
      }
      platform_extend_trial: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_days: number
          p_organization_id: string
          p_reason: string
          p_server_key: string
        }
        Returns: Json
      }
      platform_get_organization: {
        Args: { p_organization_id: string; p_server_key: string }
        Returns: Json
      }
      platform_health: {
        Args: { p_secret_names?: string[]; p_server_key: string }
        Returns: Json
      }
      platform_list_announcements: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: {
          audience: string
          body: string
          created_at: string
          dismissals: number
          ended_at: string
          ends_at: string
          id: string
          kind: string
          link_label: string
          link_url: string
          starts_at: string
          title: string
          updated_at: string
        }[]
      }
      platform_list_audit_events: {
        Args: {
          p_action?: string
          p_before_id?: number
          p_limit?: number
          p_organization_id?: string
          p_server_key: string
        }
        Returns: {
          action: string
          actor_email: string
          actor_user_id: string
          after_data: Json
          before_data: Json
          id: number
          occurred_at: string
          organization_id: string
          reason: string
          target_id: string
          target_type: string
        }[]
      }
      platform_list_organizations: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_plan?: string
          p_search?: string
          p_server_key: string
          p_situation?: string
        }
        Returns: {
          access_state: string
          active_members: number
          ai_cap_cents: number
          ai_cost_cents: number
          billing_interval: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          last_activity_at: string
          leads_last_30_days: number
          name: string
          organization_id: string
          owned_listings: number
          plan_key: string
          platform_blocked_at: string
          situation: string
          slug: string
          status: string
          total_count: number
          trial_ends_at: string
        }[]
      }
      platform_list_revenue_accounts: {
        Args: { p_server_key: string }
        Returns: {
          billing_interval: string
          cancel_at_period_end: boolean
          canceled_at: string
          current_period_end: string
          first_paid_at: string
          has_subscription: boolean
          name: string
          organization_created_at: string
          organization_id: string
          plan_key: string
          plan_net_monthly_cents: number
          platform_blocked_at: string
          seats: number
          slug: string
          status: string
          synced_at: string
          trial_ends_at: string
        }[]
      }
      platform_log_action: {
        Args: {
          p_action: string
          p_actor_email: string
          p_actor_user_id: string
          p_after?: Json
          p_before?: Json
          p_organization_id?: string
          p_reason?: string
          p_server_key: string
          p_target_id?: string
          p_target_type?: string
        }
        Returns: number
      }
      platform_save_announcement: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_audience: string
          p_body: string
          p_ends_at: string
          p_id?: string
          p_kind: string
          p_link_label?: string
          p_link_url?: string
          p_server_key: string
          p_starts_at: string
          p_title: string
        }
        Returns: string
      }
      platform_set_organization_block: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_blocked: boolean
          p_organization_id: string
          p_reason: string
          p_server_key: string
        }
        Returns: Json
      }
      platform_staff_accept_invitation: {
        Args: { p_server_key: string; p_token_hash: string; p_user_id: string }
        Returns: Json
      }
      platform_staff_invitation_preview: {
        Args: { p_server_key: string; p_token_hash: string; p_user_id?: string }
        Returns: Json
      }
      platform_staff_invite: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_email: string
          p_role: string
          p_server_key: string
          p_token_hash: string
        }
        Returns: Json
      }
      platform_staff_list: {
        Args: { p_owner_emails?: string[]; p_server_key: string }
        Returns: Json
      }
      platform_staff_remove: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_server_key: string
          p_user_id: string
        }
        Returns: Json
      }
      platform_staff_resend_invitation: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_invitation_id: string
          p_server_key: string
          p_token_hash: string
        }
        Returns: Json
      }
      platform_staff_revoke_invitation: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_invitation_id: string
          p_server_key: string
        }
        Returns: Json
      }
      platform_staff_role: {
        Args: { p_server_key: string; p_user_id: string }
        Returns: string
      }
      platform_staff_set_role: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_role: string
          p_server_key: string
          p_user_id: string
        }
        Returns: Json
      }
      platform_status_add_update: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_incident_id: string
          p_message: string
          p_server_key: string
          p_status: string
        }
        Returns: number
      }
      platform_status_claim_alerts: {
        Args: {
          p_limit?: number
          p_recipient_count: number
          p_server_key: string
        }
        Returns: Json
      }
      platform_status_create_incident: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_component_keys: string[]
          p_impact: string
          p_kind: string
          p_message: string
          p_scheduled_for?: string
          p_scheduled_until?: string
          p_server_key: string
          p_status?: string
          p_title: string
        }
        Returns: string
      }
      platform_status_edit_incident: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_component_keys: string[]
          p_impact: string
          p_incident_id: string
          p_scheduled_for?: string
          p_scheduled_until?: string
          p_server_key: string
          p_title: string
        }
        Returns: string
      }
      platform_status_list_incidents: {
        Args: { p_limit?: number; p_server_key: string }
        Returns: Json
      }
      platform_status_overview: {
        Args: { p_samples_per_component?: number; p_server_key: string }
        Returns: Json
      }
      platform_status_settle_alert: {
        Args: {
          p_alert_id: number
          p_emails_sent?: number
          p_outcome: string
          p_server_key: string
        }
        Returns: boolean
      }
      platform_status_take_over: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_incident_id: string
          p_server_key: string
        }
        Returns: string
      }
      purge_from_trash: {
        Args: { p_confirmation: string; p_entity: string; p_record_id: string }
        Returns: Json
      }
      queue_whatsapp_message: {
        Args: {
          p_body?: string
          p_conversation_id: string
          p_marketing?: boolean
          p_template_name?: string
        }
        Returns: Json
      }
      read_lead_integration_secret: {
        Args: {
          p_organization_id: string
          p_provider: string
          p_server_key: string
        }
        Returns: string
      }
      record_billing_invoice_paid: {
        Args: {
          p_amount_paid_cents?: number
          p_invoice_created_at?: string
          p_organization_id?: string
          p_paid_at?: string
          p_plan_net_monthly_cents?: number
          p_server_key?: string
        }
        Returns: boolean
      }
      record_billing_webhook_delivery: {
        Args: { p_event_type?: string; p_outcome: string; p_server_key: string }
        Returns: boolean
      }
      record_caixa_check: {
        Args: {
          p_failure_reason?: string
          p_origem?: string
          p_result: string
          p_server_key: string
          p_source_digest?: string
          p_source_etag?: string
          p_source_last_modified?: string
        }
        Returns: Json
      }
      record_connection_error: {
        Args: {
          p_code?: string
          p_connected_account_id?: string
          p_message?: string
          p_revoked?: boolean
          p_server_key?: string
        }
        Returns: undefined
      }
      record_consent: {
        Args: {
          p_action: Database["public"]["Enums"]["consent_action"]
          p_address: string
          p_channel: Database["public"]["Enums"]["consent_channel"]
          p_client_id?: string
          p_disclosure_text: string
          p_evidence?: Json
          p_lead_id?: string
          p_organization_id: string
          p_policy_version: string
          p_purpose: Database["public"]["Enums"]["consent_purpose"]
          p_source: Database["public"]["Enums"]["consent_source"]
          p_subject_name?: string
        }
        Returns: string
      }
      record_lead_integration_test: {
        Args: {
          p_detail?: string
          p_organization_id: string
          p_provider: string
          p_server_key: string
        }
        Returns: undefined
      }
      record_report_export: {
        Args: {
          p_dataset: string
          p_export_id: string
          p_from?: string
          p_organization_id: string
          p_rows: number
          p_team_id?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: undefined
      }
      record_report_export_rows: {
        Args: {
          p_dataset: string
          p_export_id: string
          p_from?: string
          p_organization_id: string
          p_rows: number
          p_to?: string
          p_user_id?: string
        }
        Returns: undefined
      }
      record_webhook_event: {
        Args: {
          p_event_key?: string
          p_payload_sha256?: string
          p_provider?: string
          p_server_key?: string
        }
        Returns: boolean
      }
      register_lead_delivery: {
        Args: {
          p_external_account_id: string
          p_external_event_id: string
          p_occurred_at?: string
          p_origin?: string
          p_provider: string
          p_server_key: string
        }
        Returns: Json
      }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_device_label?: string
          p_endpoint: string
          p_organization_id?: string
          p_p256dh: string
        }
        Returns: string
      }
      register_shared_proposal_view: {
        Args: { p_token: string }
        Returns: undefined
      }
      register_whatsapp_channel: {
        Args: {
          p_connected_account_id?: string
          p_display_phone_number?: string
          p_nonce?: string
          p_organization_id?: string
          p_phone_number_id?: string
          p_server_key?: string
          p_verified_name?: string
          p_waba_id?: string
        }
        Returns: Json
      }
      release_whatsapp_suppression: {
        Args: { p_reason?: string; p_suppression_id: string }
        Returns: Json
      }
      report_broker_performance: {
        Args: { p_from?: string; p_organization_id: string; p_to?: string }
        Returns: {
          first_response_median_minutes: number
          full_name: string
          leads_answered: number
          leads_in_sla: number
          leads_lost: number
          leads_open: number
          leads_received: number
          leads_taken_by_sla: number
          leads_won: number
          member_active: boolean
          member_role: Database["public"]["Enums"]["app_role"]
          properties_captured: number
          proposals_closed: number
          proposals_closed_amount: number
          proposals_made: number
          user_id: string
        }[]
      }
      report_broker_performance_by_team: {
        Args: {
          p_from?: string
          p_organization_id: string
          p_team_id?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          first_response_median_minutes: number
          full_name: string
          leads_answered: number
          leads_in_sla: number
          leads_lost: number
          leads_open: number
          leads_received: number
          leads_taken_by_sla: number
          leads_won: number
          member_active: boolean
          member_role: Database["public"]["Enums"]["app_role"]
          properties_captured: number
          proposals_closed: number
          proposals_closed_amount: number
          proposals_made: number
          rentals_closed: number
          rentals_closed_amount: number
          sales_closed: number
          sales_closed_amount: number
          team_id: string
          team_name: string
          user_id: string
        }[]
      }
      report_broker_visits: {
        Args: { p_from?: string; p_organization_id: string; p_to?: string }
        Returns: {
          user_id: string
          visits_canceled: number
          visits_done: number
          visits_no_show: number
          visits_scheduled: number
        }[]
      }
      report_forecast_proposals: {
        Args: {
          p_limit?: number
          p_organization_id: string
          p_team_id?: string
          p_user_id?: string
        }
        Returns: {
          amount: number
          broker_id: string
          broker_name: string
          can_edit: boolean
          created_at: string
          expected_close_date: string
          id: string
          probability: number
          property_code: string
          property_id: string
          property_title: string
          purpose: Database["public"]["Enums"]["listing_purpose"]
          status: Database["public"]["Enums"]["proposal_status"]
          team_name: string
          valid_until: string
        }[]
      }
      report_lead_lost_reasons: {
        Args: {
          p_from?: string
          p_limit?: number
          p_organization_id: string
          p_team_id?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          lost_reason: string
          total: number
        }[]
      }
      report_lead_sources: {
        Args: {
          p_from?: string
          p_limit?: number
          p_organization_id: string
          p_team_id?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          answered: number
          investment: number
          landing_page_id: string
          landing_page_name: string
          leads: number
          lost: number
          open_leads: number
          source: Database["public"]["Enums"]["lead_source"]
          utm_campaign: string
          utm_medium: string
          utm_source: string
          won: number
        }[]
      }
      report_sales_forecast: {
        Args: {
          p_organization_id: string
          p_team_id?: string
          p_today?: string
          p_user_id?: string
        }
        Returns: {
          amount: number
          bucket: string
          full_name: string
          proposals: number
          purpose: Database["public"]["Enums"]["listing_purpose"]
          team_id: string
          team_name: string
          user_id: string
          weighted_amount: number
        }[]
      }
      report_sales_goals: {
        Args: {
          p_month?: string
          p_organization_id: string
          p_team_id?: string
          p_user_id?: string
        }
        Returns: {
          goal_leads_answered: number
          goal_proposals: number
          goal_rentals_amount: number
          goal_rentals_count: number
          goal_sales_amount: number
          goal_sales_count: number
          goal_visits: number
          kind: string
          leads_answered: number
          member_active: boolean
          member_role: Database["public"]["Enums"]["app_role"]
          name: string
          proposals: number
          rentals_amount: number
          rentals_count: number
          sales_amount: number
          sales_count: number
          target_id: string
          team_id: string
          team_name: string
          visits: number
        }[]
      }
      report_stage_funnel: {
        Args: {
          p_from?: string
          p_organization_id: string
          p_team_id?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          advanced: number
          avg_hours: number
          entered: number
          lost_after: number
          median_hours: number
          stage: Database["public"]["Enums"]["lead_stage"]
          still_there: number
        }[]
      }
      request_proposal_discount: {
        Args: { p_proposal_id: string; p_reason?: string }
        Returns: Json
      }
      reserve_ai_usage: {
        Args: {
          p_batch?: boolean
          p_cache_read_tokens?: number
          p_cache_write_tokens?: number
          p_contact_key?: string
          p_digest?: string
          p_input_tokens?: number
          p_kind?: string
          p_model?: string
          p_organization_id?: string
          p_output_tokens?: number
          p_server_key?: string
          p_units?: number
          p_user_id?: string
        }
        Returns: Json
      }
      reserve_email_send: {
        Args: {
          p_ceiling: number
          p_kind: string
          p_notice_key: string
          p_organization_slug?: string
          p_priority: number
          p_server_key: string
        }
        Returns: Json
      }
      restore_from_trash: {
        Args: { p_entity: string; p_record_id: string }
        Returns: undefined
      }
      review_proposal_discount: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: Json
      }
      revoke_proposal_share: {
        Args: { p_proposal_id: string }
        Returns: boolean
      }
      rotate_feed_token: {
        Args: { p_organization_id: string }
        Returns: string
      }
      save_lead_integration_state: {
        Args: {
          p_credential_rejected?: boolean
          p_cursor?: Json
          p_error?: string
          p_organization_id: string
          p_provider: string
          p_server_key: string
          p_tested?: boolean
        }
        Returns: undefined
      }
      save_marketing_investment: {
        Args: {
          p_amount: number
          p_month: string
          p_notes?: string
          p_organization_id: string
          p_source: Database["public"]["Enums"]["lead_source"]
          p_utm_campaign: string
        }
        Returns: string
      }
      save_sales_goal: {
        Args: {
          p_leads_answered?: number
          p_month: string
          p_organization_id: string
          p_proposals?: number
          p_rentals_amount?: number
          p_rentals_count?: number
          p_sales_amount?: number
          p_sales_count?: number
          p_team_id?: string
          p_user_id?: string
          p_visits?: number
        }
        Returns: string
      }
      schedule_organization_deletion: {
        Args: { p_confirmation: string; p_organization_id: string }
        Returns: Json
      }
      search_caixa_listings: {
        Args: {
          p_bairro?: string
          p_cidade?: string
          p_financiamento?: boolean
          p_include_delisted?: boolean
          p_limit?: number
          p_max_price?: number
          p_min_price?: number
          p_modalidade?: string
          p_offset?: number
          p_only_favorites?: boolean
          p_organization_id: string
          p_sort?: string
          p_term?: string
          p_tipo?: Database["public"]["Enums"]["property_type"]
          p_uf?: string
        }
        Returns: {
          aceita_financiamento: boolean
          area_privativa: number
          area_terreno: number
          area_total: number
          bairro: string
          cidade: string
          desconto: number
          descricao: string
          endereco: string
          is_favorite: boolean
          link: string
          link_count: number
          lista_gerada_em: string
          modalidade: string
          numero: string
          preco: number
          primeira_vez_em: string
          quartos: number
          saiu_da_lista_em: string
          tipo: Database["public"]["Enums"]["property_type"]
          total_count: number
          uf: string
          vagas: number
          valor_avaliacao: number
        }[]
      }
      search_clients: {
        Args: {
          p_assigned_to?: string
          p_kind?: Database["public"]["Enums"]["client_kind"]
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_source?: string
          p_tag?: string
          p_term?: string
          p_unassigned?: boolean
        }
        Returns: {
          assigned_to: string
          created_at: string
          document: string
          email: string
          id: string
          kind: Database["public"]["Enums"]["client_kind"]
          name: string
          phone: string
          source: string
          tags: string[]
          total_count: number
          trade_name: string
          whatsapp: string
        }[]
      }
      search_crm: {
        Args: { p_limit?: number; p_organization_id: string; p_term: string }
        Returns: {
          code: string
          entity: string
          id: string
          phone: string
          place: string
          status: string
          title: string
        }[]
      }
      search_properties: {
        Args: {
          p_authorization?: string
          p_limit?: number
          p_max_price?: number
          p_min_bedrooms?: number
          p_min_price?: number
          p_offset?: number
          p_organization_id: string
          p_purpose?: Database["public"]["Enums"]["listing_purpose"]
          p_status?: Database["public"]["Enums"]["property_status"]
          p_term?: string
          p_type?: Database["public"]["Enums"]["property_type"]
        }
        Returns: {
          authorization_ends_on: string
          authorization_state: string
          broker_id: string
          captured_by: string
          city: string
          code: string
          cover_path: string
          id: string
          imob_score: number
          is_restricted: boolean
          matched_owner: string
          neighborhood: string
          published_to_portals: boolean
          purpose: Database["public"]["Enums"]["listing_purpose"]
          rent_price: number
          sale_price: number
          state: string
          status: Database["public"]["Enums"]["property_status"]
          title: string
          total_count: number
          type: Database["public"]["Enums"]["property_type"]
        }[]
      }
      set_ai_overage_cap: {
        Args: { p_cents: number; p_organization_id: string }
        Returns: number
      }
      set_commission_partner: {
        Args: {
          p_commission_id: string
          p_partner_name?: string
          p_percent?: number
        }
        Returns: Json
      }
      set_connection_enabled: {
        Args: { p_connected_account_id: string; p_enabled: boolean }
        Returns: Json
      }
      set_connection_platform_block: {
        Args: {
          p_blocked?: boolean
          p_connected_account_id?: string
          p_reason?: string
          p_server_key?: string
        }
        Returns: Json
      }
      set_export_roles: {
        Args: {
          p_organization_id: string
          p_roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      set_proposal_expected_close_date: {
        Args: {
          p_expected_close_date: string
          p_organization_id: string
          p_proposal_id: string
        }
        Returns: string
      }
      set_proposal_stage_probabilities: {
        Args: {
          p_countered: number
          p_draft: number
          p_organization_id: string
          p_sent: number
        }
        Returns: undefined
      }
      set_referral_confirmation_notice: {
        Args: {
          p_claim?: boolean
          p_referred_organization_id?: string
          p_referrer_organization_id?: string
          p_server_key?: string
        }
        Returns: boolean
      }
      set_referral_ineligibility: {
        Args: {
          p_organization_id?: string
          p_reason?: string
          p_server_key?: string
        }
        Returns: boolean
      }
      set_whatsapp_channel_enabled: {
        Args: { p_channel_id: string; p_enabled: boolean }
        Returns: Json
      }
      set_whatsapp_marketing_preference: {
        Args: {
          p_at?: string
          p_contact_wa_id?: string
          p_phone_number_id?: string
          p_server_key?: string
          p_value?: string
        }
        Returns: Json
      }
      settle_ai_usage: {
        Args: {
          p_batch?: boolean
          p_cache_read_tokens?: number
          p_cache_write_tokens?: number
          p_input_tokens?: number
          p_model?: string
          p_organization_id?: string
          p_output_tokens?: number
          p_reservation_id?: string
          p_response?: string
          p_server_key?: string
          p_status?: string
        }
        Returns: Json
      }
      settle_authorization_alerts: {
        Args: {
          p_failed?: string[]
          p_released?: string[]
          p_sent?: string[]
          p_server_key: string
        }
        Returns: Json
      }
      settle_daily_digests: {
        Args: {
          p_failed?: string[]
          p_released?: string[]
          p_sent?: string[]
          p_server_key: string
        }
        Returns: Json
      }
      settle_email_send: {
        Args: {
          p_day: string
          p_kind: string
          p_notice_key: string
          p_organization_slug?: string
          p_priority: number
          p_reason?: string
          p_sent?: boolean
          p_server_key: string
        }
        Returns: Json
      }
      settle_lead_notifications: {
        Args: { p_failed?: string[]; p_sent?: string[]; p_server_key: string }
        Returns: Json
      }
      settle_organization_storage_purge: {
        Args: { p_server_key: string }
        Returns: Json
      }
      settle_push_deliveries: {
        Args: {
          p_delivered?: string[]
          p_gone?: string[]
          p_server_key: string
        }
        Returns: Json
      }
      settle_storage_purge_queue: {
        Args: { p_organization_id: string }
        Returns: number
      }
      settle_task_reminders: {
        Args: {
          p_failed?: string[]
          p_released?: string[]
          p_sent?: string[]
          p_server_key: string
        }
        Returns: Json
      }
      settle_visit_assignment_notices: {
        Args: {
          p_failed?: string[]
          p_released?: string[]
          p_sent?: string[]
          p_server_key: string
        }
        Returns: Json
      }
      settle_visit_reminders: {
        Args: {
          p_failed?: string[]
          p_released?: string[]
          p_sent?: string[]
          p_server_key: string
        }
        Returns: Json
      }
      settle_weekly_reports: {
        Args: {
          p_failed?: string[]
          p_released?: string[]
          p_sent?: string[]
          p_server_key: string
        }
        Returns: Json
      }
      share_proposal: {
        Args: { p_days?: number; p_proposal_id: string; p_rotate?: boolean }
        Returns: Json
      }
      start_data_export: {
        Args: {
          p_dataset: string
          p_from?: string
          p_organization_id: string
          p_period_preset?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          allowed: boolean
          export_id: string
        }[]
      }
      start_report_export: {
        Args: {
          p_dataset: string
          p_from?: string
          p_organization_id: string
          p_period_preset?: string
          p_team_id?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          allowed: boolean
          export_id: string
        }[]
      }
      status_ping: { Args: never; Returns: boolean }
      submit_capture_request: {
        Args: {
          org_slug: string
          p_client_key?: string
          p_nonce?: string
          p_server_key?: string
          payload: Json
        }
        Returns: string
      }
      submit_landing_lead: {
        Args: {
          p_client_key?: string
          p_nonce?: string
          p_org_slug: string
          p_page_slug: string
          p_payload: Json
          p_server_key?: string
        }
        Returns: undefined
      }
      submit_property_lead: {
        Args: {
          p_client_key?: string
          p_nonce?: string
          p_org_slug: string
          p_payload: Json
          p_property_code: string
          p_server_key?: string
        }
        Returns: undefined
      }
      sync_billing_account: {
        Args: {
          p_organization_id?: string
          p_payload?: Json
          p_server_key?: string
        }
        Returns: undefined
      }
      sync_push_subscription: {
        Args: { p_auth: string; p_endpoint: string; p_p256dh: string }
        Returns: string
      }
      sync_whatsapp_channel_health: {
        Args: {
          p_display_phone_number?: string
          p_messaging_tier?: string
          p_phone_number_id?: string
          p_quality_rating?: string
          p_server_key?: string
          p_throughput?: number
        }
        Returns: Json
      }
      unregister_push_subscription: {
        Args: { p_endpoint: string }
        Returns: boolean
      }
      update_whatsapp_message_status: {
        Args: {
          p_at?: string
          p_error_code?: number
          p_error_title?: string
          p_phone_number_id?: string
          p_pricing_category?: string
          p_pricing_type?: string
          p_server_key?: string
          p_status?: string
          p_wamid?: string
        }
        Returns: Json
      }
    }
    Enums: {
      activity_type:
        | "note"
        | "call"
        | "email"
        | "whatsapp"
        | "visit"
        | "meeting"
        | "status_change"
      address_display: "full" | "street" | "neighborhood"
      app_role:
        | "owner"
        | "manager"
        | "broker"
        | "capturer"
        | "assistant"
        | "finance"
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "done"
        | "no_show"
        | "canceled"
      capture_request_status: "new" | "contacted" | "converted" | "discarded"
      client_kind: "pf" | "pj"
      commission_basis: "percent" | "fixed"
      commission_role: "capturer" | "seller" | "manager" | "agency" | "partner"
      commission_status: "pending" | "partially_paid" | "paid" | "canceled"
      connection_event_action:
        | "connected"
        | "reconnected"
        | "enabled"
        | "disabled"
        | "blocked"
        | "unblocked"
        | "terms_accepted"
        | "disconnected"
        | "error"
      connection_provider:
        | "whatsapp"
        | "instagram"
        | "facebook_page"
        | "facebook_lead_ads"
        | "email_forwarding"
        | "telegram"
      connection_status: "pending" | "connected" | "error" | "revoked"
      consent_action: "granted" | "revoked"
      consent_channel: "whatsapp" | "email" | "sms" | "telefone" | "presencial"
      consent_purpose:
        | "atendimento"
        | "envio_de_imoveis"
        | "divulgacao"
        | "pesquisa_satisfacao"
        | "compartilhamento_parceiros"
      consent_source:
        | "formulario_site"
        | "landing_page"
        | "captacao_publica"
        | "whatsapp_opt_in"
        | "portal"
        | "indicacao"
        | "atendimento_presencial"
        | "telefone"
        | "contrato"
        | "importacao"
      discount_request_status: "pending" | "approved" | "rejected"
      import_duplicate_mode: "skip" | "update"
      import_kind: "clients" | "leads" | "properties"
      key_status: "available" | "checked_out" | "lost"
      landing_status: "draft" | "published" | "archived"
      landing_template:
        | "campaign_spotlight"
        | "campaign_offer"
        | "campaign_valuation"
        | "launch_showcase"
        | "launch_waitlist"
        | "launch_units"
        | "portfolio_grid"
        | "portfolio_agency"
        | "portfolio_broker"
      lead_contact_channel: "call" | "whatsapp" | "email" | "in_person"
      lead_delivery_status:
        | "pending"
        | "accepted"
        | "duplicate"
        | "rejected"
        | "failed"
        | "ignored"
      lead_integration_provider: "canal_pro" | "meta_lead_ads"
      lead_integration_status: "disconnected" | "connected" | "error"
      lead_source:
        | "landing_page"
        | "portal"
        | "website"
        | "social"
        | "instagram"
        | "whatsapp"
        | "referral"
        | "manual"
        | "other"
      lead_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "visit_scheduled"
        | "proposal"
        | "won"
        | "lost"
      listing_purpose: "sale" | "rent" | "sale_rent"
      media_kind: "image" | "video" | "tour"
      organization_plan: "small" | "medium" | "large"
      property_document_kind:
        | "registry"
        | "iptu"
        | "floor_plan"
        | "occupancy_permit"
        | "certificate"
        | "listing_agreement"
        | "other"
      property_status:
        | "draft"
        | "active"
        | "reserved"
        | "sold"
        | "rented"
        | "inactive"
      property_type:
        | "apartment"
        | "house"
        | "condo_house"
        | "penthouse"
        | "studio"
        | "flat"
        | "land"
        | "commercial_room"
        | "office"
        | "store"
        | "warehouse"
        | "building"
        | "farm"
        | "ranch"
        | "other"
      property_usage: "residential" | "commercial" | "rural" | "industrial"
      proposal_round_kind: "initial" | "owner_counter" | "client_offer"
      proposal_status:
        | "draft"
        | "sent"
        | "countered"
        | "accepted"
        | "rejected"
        | "withdrawn"
      task_priority: "low" | "medium" | "high"
      task_status: "open" | "done" | "canceled"
      whatsapp_message_direction: "inbound" | "outbound"
      whatsapp_message_status:
        | "queued"
        | "accepted"
        | "held"
        | "sent"
        | "delivered"
        | "read"
        | "played"
        | "failed"
        | "discarded"
      whatsapp_quality_rating: "GREEN" | "YELLOW" | "RED" | "UNKNOWN"
      whatsapp_suppression_scope: "marketing" | "all"
      whatsapp_suppression_source:
        | "user_preferences"
        | "delivery_error"
        | "keyword"
        | "consent_revoked"
        | "manual"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "note",
        "call",
        "email",
        "whatsapp",
        "visit",
        "meeting",
        "status_change",
      ],
      address_display: ["full", "street", "neighborhood"],
      app_role: [
        "owner",
        "manager",
        "broker",
        "capturer",
        "assistant",
        "finance",
      ],
      appointment_status: [
        "scheduled",
        "confirmed",
        "done",
        "no_show",
        "canceled",
      ],
      capture_request_status: ["new", "contacted", "converted", "discarded"],
      client_kind: ["pf", "pj"],
      commission_basis: ["percent", "fixed"],
      commission_role: ["capturer", "seller", "manager", "agency", "partner"],
      commission_status: ["pending", "partially_paid", "paid", "canceled"],
      connection_event_action: [
        "connected",
        "reconnected",
        "enabled",
        "disabled",
        "blocked",
        "unblocked",
        "terms_accepted",
        "disconnected",
        "error",
      ],
      connection_provider: [
        "whatsapp",
        "instagram",
        "facebook_page",
        "facebook_lead_ads",
        "email_forwarding",
        "telegram",
      ],
      connection_status: ["pending", "connected", "error", "revoked"],
      consent_action: ["granted", "revoked"],
      consent_channel: ["whatsapp", "email", "sms", "telefone", "presencial"],
      consent_purpose: [
        "atendimento",
        "envio_de_imoveis",
        "divulgacao",
        "pesquisa_satisfacao",
        "compartilhamento_parceiros",
      ],
      consent_source: [
        "formulario_site",
        "landing_page",
        "captacao_publica",
        "whatsapp_opt_in",
        "portal",
        "indicacao",
        "atendimento_presencial",
        "telefone",
        "contrato",
        "importacao",
      ],
      discount_request_status: ["pending", "approved", "rejected"],
      import_duplicate_mode: ["skip", "update"],
      import_kind: ["clients", "leads", "properties"],
      key_status: ["available", "checked_out", "lost"],
      landing_status: ["draft", "published", "archived"],
      landing_template: [
        "campaign_spotlight",
        "campaign_offer",
        "campaign_valuation",
        "launch_showcase",
        "launch_waitlist",
        "launch_units",
        "portfolio_grid",
        "portfolio_agency",
        "portfolio_broker",
      ],
      lead_contact_channel: ["call", "whatsapp", "email", "in_person"],
      lead_delivery_status: [
        "pending",
        "accepted",
        "duplicate",
        "rejected",
        "failed",
        "ignored",
      ],
      lead_integration_provider: ["canal_pro", "meta_lead_ads"],
      lead_integration_status: ["disconnected", "connected", "error"],
      lead_source: [
        "landing_page",
        "portal",
        "website",
        "social",
        "instagram",
        "whatsapp",
        "referral",
        "manual",
        "other",
      ],
      lead_stage: [
        "new",
        "contacted",
        "qualified",
        "visit_scheduled",
        "proposal",
        "won",
        "lost",
      ],
      listing_purpose: ["sale", "rent", "sale_rent"],
      media_kind: ["image", "video", "tour"],
      organization_plan: ["small", "medium", "large"],
      property_document_kind: [
        "registry",
        "iptu",
        "floor_plan",
        "occupancy_permit",
        "certificate",
        "listing_agreement",
        "other",
      ],
      property_status: [
        "draft",
        "active",
        "reserved",
        "sold",
        "rented",
        "inactive",
      ],
      property_type: [
        "apartment",
        "house",
        "condo_house",
        "penthouse",
        "studio",
        "flat",
        "land",
        "commercial_room",
        "office",
        "store",
        "warehouse",
        "building",
        "farm",
        "ranch",
        "other",
      ],
      property_usage: ["residential", "commercial", "rural", "industrial"],
      proposal_round_kind: ["initial", "owner_counter", "client_offer"],
      proposal_status: [
        "draft",
        "sent",
        "countered",
        "accepted",
        "rejected",
        "withdrawn",
      ],
      task_priority: ["low", "medium", "high"],
      task_status: ["open", "done", "canceled"],
      whatsapp_message_direction: ["inbound", "outbound"],
      whatsapp_message_status: [
        "queued",
        "accepted",
        "held",
        "sent",
        "delivered",
        "read",
        "played",
        "failed",
        "discarded",
      ],
      whatsapp_quality_rating: ["GREEN", "YELLOW", "RED", "UNKNOWN"],
      whatsapp_suppression_scope: ["marketing", "all"],
      whatsapp_suppression_source: [
        "user_preferences",
        "delivery_error",
        "keyword",
        "consent_revoked",
        "manual",
      ],
    },
  },
} as const
