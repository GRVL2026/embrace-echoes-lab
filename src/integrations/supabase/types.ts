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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      allowed_emails: {
        Row: {
          email: string
          role: string
        }
        Insert: {
          email: string
          role?: string
        }
        Update: {
          email?: string
          role?: string
        }
        Relationships: []
      }
      brand_modules: {
        Row: {
          brand_id: string
          content: Json
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          position: number
          reusable: boolean
          slide_number: number | null
          slug: string
          subtitle: string | null
          title: string | null
          type: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          content?: Json
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          position?: number
          reusable?: boolean
          slide_number?: number | null
          slug: string
          subtitle?: string | null
          title?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          content?: Json
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          position?: number
          reusable?: boolean
          slide_number?: number | null
          slug?: string
          subtitle?: string | null
          title?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_modules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          accent: string | null
          color: string | null
          contact: Json
          created_at: string
          id: string
          is_active: boolean
          key: string
          logo_url: string | null
          name: string
          pitch: string | null
          tagline: string | null
          updated_at: string
        }
        Insert: {
          accent?: string | null
          color?: string | null
          contact?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          logo_url?: string | null
          name: string
          pitch?: string | null
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          accent?: string | null
          color?: string | null
          contact?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          logo_url?: string | null
          name?: string
          pitch?: string | null
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      catalog_products: {
        Row: {
          active: boolean
          category: string
          cegid_code: string | null
          center_placement: boolean | null
          color: string | null
          created_at: string
          depth: number
          description: string | null
          height: number
          icon: string | null
          id: string
          images: string[] | null
          model3d: string | null
          model3d_rotation: number
          name: string
          player_clearance: number | null
          pmr_accessible: boolean | null
          price: number | null
          price_erp_ht: number | null
          price_monthly: number | null
          product_url: string | null
          safety_zone: number
          shopify_id: string | null
          specs: Json | null
          stock: string | null
          stock_erp: number | null
          stock_maj: string | null
          tags: string[] | null
          updated_at: string
          vendor: string | null
          video_url: string | null
          warranty: string | null
          width: number
        }
        Insert: {
          active?: boolean
          category?: string
          cegid_code?: string | null
          center_placement?: boolean | null
          color?: string | null
          created_at?: string
          depth?: number
          description?: string | null
          height?: number
          icon?: string | null
          id?: string
          images?: string[] | null
          model3d?: string | null
          model3d_rotation?: number
          name: string
          player_clearance?: number | null
          pmr_accessible?: boolean | null
          price?: number | null
          price_erp_ht?: number | null
          price_monthly?: number | null
          product_url?: string | null
          safety_zone?: number
          shopify_id?: string | null
          specs?: Json | null
          stock?: string | null
          stock_erp?: number | null
          stock_maj?: string | null
          tags?: string[] | null
          updated_at?: string
          vendor?: string | null
          video_url?: string | null
          warranty?: string | null
          width?: number
        }
        Update: {
          active?: boolean
          category?: string
          cegid_code?: string | null
          center_placement?: boolean | null
          color?: string | null
          created_at?: string
          depth?: number
          description?: string | null
          height?: number
          icon?: string | null
          id?: string
          images?: string[] | null
          model3d?: string | null
          model3d_rotation?: number
          name?: string
          player_clearance?: number | null
          pmr_accessible?: boolean | null
          price?: number | null
          price_erp_ht?: number | null
          price_monthly?: number | null
          product_url?: string | null
          safety_zone?: number
          shopify_id?: string | null
          specs?: Json | null
          stock?: string | null
          stock_erp?: number | null
          stock_maj?: string | null
          tags?: string[] | null
          updated_at?: string
          vendor?: string | null
          video_url?: string | null
          warranty?: string | null
          width?: number
        }
        Relationships: []
      }
      catalogue_erp: {
        Row: {
          code: string
          description: string | null
          famille: string | null
          maj: string | null
          prix_ht: number | null
          stock: number | null
        }
        Insert: {
          code: string
          description?: string | null
          famille?: string | null
          maj?: string | null
          prix_ht?: number | null
          stock?: number | null
        }
        Update: {
          code?: string
          description?: string | null
          famille?: string | null
          maj?: string | null
          prix_ht?: number | null
          stock?: number | null
        }
        Relationships: []
      }
      copilot_assets: {
        Row: {
          asset_type: string
          bounding_box: number[] | null
          category: string
          color_tags: string[] | null
          created_at: string
          description: string | null
          dimensions: number[] | null
          file_size_mb: number | null
          file_url: string | null
          format: string
          id: string
          is_active: boolean
          is_curated: boolean | null
          license: string | null
          license_ok: boolean | null
          material_tags: string[] | null
          name: string
          performance_tier: string | null
          polycount: number | null
          preview_url: string | null
          provider_asset_id: string | null
          room_tags: string[] | null
          rotation_default: number[] | null
          scale_default: number[] | null
          source: string | null
          source_provider: string | null
          style_tags: string[] | null
          subcategory: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          asset_type?: string
          bounding_box?: number[] | null
          category?: string
          color_tags?: string[] | null
          created_at?: string
          description?: string | null
          dimensions?: number[] | null
          file_size_mb?: number | null
          file_url?: string | null
          format?: string
          id?: string
          is_active?: boolean
          is_curated?: boolean | null
          license?: string | null
          license_ok?: boolean | null
          material_tags?: string[] | null
          name: string
          performance_tier?: string | null
          polycount?: number | null
          preview_url?: string | null
          provider_asset_id?: string | null
          room_tags?: string[] | null
          rotation_default?: number[] | null
          scale_default?: number[] | null
          source?: string | null
          source_provider?: string | null
          style_tags?: string[] | null
          subcategory?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          asset_type?: string
          bounding_box?: number[] | null
          category?: string
          color_tags?: string[] | null
          created_at?: string
          description?: string | null
          dimensions?: number[] | null
          file_size_mb?: number | null
          file_url?: string | null
          format?: string
          id?: string
          is_active?: boolean
          is_curated?: boolean | null
          license?: string | null
          license_ok?: boolean | null
          material_tags?: string[] | null
          name?: string
          performance_tier?: string | null
          polycount?: number | null
          preview_url?: string | null
          provider_asset_id?: string | null
          room_tags?: string[] | null
          rotation_default?: number[] | null
          scale_default?: number[] | null
          source?: string | null
          source_provider?: string | null
          style_tags?: string[] | null
          subcategory?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      copilot_textures: {
        Row: {
          albedo_url: string | null
          color_tags: string[] | null
          created_at: string
          id: string
          is_active: boolean
          metalness_url: string | null
          name: string
          normal_url: string | null
          polyhaven_id: string | null
          repeat_scale: number | null
          room_usage: string[] | null
          roughness_url: string | null
          source: string
          style_tags: string[] | null
          texture_type: string
          updated_at: string
        }
        Insert: {
          albedo_url?: string | null
          color_tags?: string[] | null
          created_at?: string
          id?: string
          is_active?: boolean
          metalness_url?: string | null
          name: string
          normal_url?: string | null
          polyhaven_id?: string | null
          repeat_scale?: number | null
          room_usage?: string[] | null
          roughness_url?: string | null
          source?: string
          style_tags?: string[] | null
          texture_type?: string
          updated_at?: string
        }
        Update: {
          albedo_url?: string | null
          color_tags?: string[] | null
          created_at?: string
          id?: string
          is_active?: boolean
          metalness_url?: string | null
          name?: string
          normal_url?: string | null
          polyhaven_id?: string | null
          repeat_scale?: number | null
          room_usage?: string[] | null
          roughness_url?: string | null
          source?: string
          style_tags?: string[] | null
          texture_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      copilote_feedback: {
        Row: {
          commentaire: string | null
          created_at: string
          id: string
          note: number
          question: string
          reponse: string
          requetes_sql: Json
          user_id: string
        }
        Insert: {
          commentaire?: string | null
          created_at?: string
          id?: string
          note: number
          question: string
          reponse: string
          requetes_sql?: Json
          user_id: string
        }
        Update: {
          commentaire?: string | null
          created_at?: string
          id?: string
          note?: number
          question?: string
          reponse?: string
          requetes_sql?: Json
          user_id?: string
        }
        Relationships: []
      }
      copilote_memoire: {
        Row: {
          actif: boolean
          auteur: string | null
          categorie: string
          contenu: string
          created_at: string
          id: string
        }
        Insert: {
          actif?: boolean
          auteur?: string | null
          categorie?: string
          contenu: string
          created_at?: string
          id?: string
        }
        Update: {
          actif?: boolean
          auteur?: string | null
          categorie?: string
          contenu?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      dossier_learning: {
        Row: {
          brand_id: string | null
          brief: string | null
          id: string
          offer: string | null
          owner_id: string | null
          products: Json
          project_id: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          brief?: string | null
          id?: string
          offer?: string | null
          owner_id?: string | null
          products?: Json
          project_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          brief?: string | null
          id?: string
          offer?: string | null
          owner_id?: string | null
          products?: Json
          project_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_learning_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_vues: {
        Row: {
          id: number
          project_id: string
          user_agent: string | null
          viewed_at: string
        }
        Insert: {
          id?: never
          project_id: string
          user_agent?: string | null
          viewed_at?: string
        }
        Update: {
          id?: never
          project_id?: string
          user_agent?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_vues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      external_asset_sources: {
        Row: {
          created_at: string
          download_format: string | null
          downloaded_at: string | null
          id: string
          license_type: string | null
          original_metadata: Json | null
          provider: string
          provider_asset_id: string
          provider_url: string | null
          source_user: string | null
        }
        Insert: {
          created_at?: string
          download_format?: string | null
          downloaded_at?: string | null
          id?: string
          license_type?: string | null
          original_metadata?: Json | null
          provider?: string
          provider_asset_id: string
          provider_url?: string | null
          source_user?: string | null
        }
        Update: {
          created_at?: string
          download_format?: string | null
          downloaded_at?: string | null
          id?: string
          license_type?: string | null
          original_metadata?: Json | null
          provider?: string
          provider_asset_id?: string
          provider_url?: string | null
          source_user?: string | null
        }
        Relationships: []
      }
      gaia_client_groupes: {
        Row: {
          code_client: string
          groupe: string
        }
        Insert: {
          code_client: string
          groupe: string
        }
        Update: {
          code_client?: string
          groupe?: string
        }
        Relationships: []
      }
      gaia_clients: {
        Row: {
          customer_id: string
          name: string | null
          status: string | null
          typologie: string | null
        }
        Insert: {
          customer_id: string
          name?: string | null
          status?: string | null
          typologie?: string | null
        }
        Update: {
          customer_id?: string
          name?: string | null
          status?: string | null
          typologie?: string | null
        }
        Relationships: []
      }
      gaia_commandes: {
        Row: {
          branch: string | null
          classe_article: string | null
          classe_client: string | null
          code_article: string | null
          code_client: string | null
          completed: boolean | null
          date_liv: string | null
          devise: string | null
          id: number
          inventory_id: string | null
          invoice_date: string | null
          line_nbr: number | null
          marge_brut: number | null
          montant_ht: number | null
          n_cde: string | null
          order_nbr: string | null
          order_type: string | null
          pu_rem: number | null
          qty: number | null
          statut: string | null
          type_cde: string | null
          unit_cost: number | null
        }
        Insert: {
          branch?: string | null
          classe_article?: string | null
          classe_client?: string | null
          code_article?: string | null
          code_client?: string | null
          completed?: boolean | null
          date_liv?: string | null
          devise?: string | null
          id?: never
          inventory_id?: string | null
          invoice_date?: string | null
          line_nbr?: number | null
          marge_brut?: number | null
          montant_ht?: number | null
          n_cde?: string | null
          order_nbr?: string | null
          order_type?: string | null
          pu_rem?: number | null
          qty?: number | null
          statut?: string | null
          type_cde?: string | null
          unit_cost?: number | null
        }
        Update: {
          branch?: string | null
          classe_article?: string | null
          classe_client?: string | null
          code_article?: string | null
          code_client?: string | null
          completed?: boolean | null
          date_liv?: string | null
          devise?: string | null
          id?: never
          inventory_id?: string | null
          invoice_date?: string | null
          line_nbr?: number | null
          marge_brut?: number | null
          montant_ht?: number | null
          n_cde?: string | null
          order_nbr?: string | null
          order_type?: string | null
          pu_rem?: number | null
          qty?: number | null
          statut?: string | null
          type_cde?: string | null
          unit_cost?: number | null
        }
        Relationships: []
      }
      gaia_config: {
        Row: {
          key: string
          value: string | null
        }
        Insert: {
          key: string
          value?: string | null
        }
        Update: {
          key?: string
          value?: string | null
        }
        Relationships: []
      }
      gaia_historique: {
        Row: {
          branch: string | null
          classe_article: string | null
          classe_client: string | null
          code_article: string | null
          code_client: string | null
          devise: string | null
          id: number
          inventory_id: string | null
          invoice_date: string | null
          line_nbr: number | null
          montant_ht: number | null
          n_cde: string | null
          order_nbr: string | null
          order_type: string | null
          pu_rem: number | null
          qty: number | null
        }
        Insert: {
          branch?: string | null
          classe_article?: string | null
          classe_client?: string | null
          code_article?: string | null
          code_client?: string | null
          devise?: string | null
          id?: never
          inventory_id?: string | null
          invoice_date?: string | null
          line_nbr?: number | null
          montant_ht?: number | null
          n_cde?: string | null
          order_nbr?: string | null
          order_type?: string | null
          pu_rem?: number | null
          qty?: number | null
        }
        Update: {
          branch?: string | null
          classe_article?: string | null
          classe_client?: string | null
          code_article?: string | null
          code_client?: string | null
          devise?: string | null
          id?: never
          inventory_id?: string | null
          invoice_date?: string | null
          line_nbr?: number | null
          montant_ht?: number | null
          n_cde?: string | null
          order_nbr?: string | null
          order_type?: string | null
          pu_rem?: number | null
          qty?: number | null
        }
        Relationships: []
      }
      gaia_revues: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json | null
          erreur: string | null
          id: string
          statut: string
          titre: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json | null
          erreur?: string | null
          id?: string
          statut?: string
          titre?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json | null
          erreur?: string | null
          id?: string
          statut?: string
          titre?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gaia_stock: {
        Row: {
          atelier_famille2: string | null
          cout_stock: number | null
          dernier_cout: number | null
          description: string | null
          divers_famille2: string | null
          famille2: string | null
          famille3: string | null
          id: number
          inventory_id: string | null
          item_class: string | null
          item_status: string | null
          magasin_famille2: string | null
          prix_vente: number | null
          qty_available: number | null
          qty_on_hand: number | null
          warehouse: string | null
        }
        Insert: {
          atelier_famille2?: string | null
          cout_stock?: number | null
          dernier_cout?: number | null
          description?: string | null
          divers_famille2?: string | null
          famille2?: string | null
          famille3?: string | null
          id?: never
          inventory_id?: string | null
          item_class?: string | null
          item_status?: string | null
          magasin_famille2?: string | null
          prix_vente?: number | null
          qty_available?: number | null
          qty_on_hand?: number | null
          warehouse?: string | null
        }
        Update: {
          atelier_famille2?: string | null
          cout_stock?: number | null
          dernier_cout?: number | null
          description?: string | null
          divers_famille2?: string | null
          famille2?: string | null
          famille3?: string | null
          id?: never
          inventory_id?: string | null
          item_class?: string | null
          item_status?: string | null
          magasin_famille2?: string | null
          prix_vente?: number | null
          qty_available?: number | null
          qty_on_hand?: number | null
          warehouse?: string | null
        }
        Relationships: []
      }
      gaia_sync_log: {
        Row: {
          error: string | null
          feed: string
          finished_at: string | null
          id: number
          ok: boolean
          rows_loaded: number | null
          started_at: string
        }
        Insert: {
          error?: string | null
          feed: string
          finished_at?: string | null
          id?: never
          ok?: boolean
          rows_loaded?: number | null
          started_at?: string
        }
        Update: {
          error?: string | null
          feed?: string
          finished_at?: string | null
          id?: never
          ok?: boolean
          rows_loaded?: number | null
          started_at?: string
        }
        Relationships: []
      }
      gaia_ventes: {
        Row: {
          branch: string | null
          classe_article: string | null
          classe_client: string | null
          code_article: string | null
          code_client: string | null
          devise: string | null
          id: number
          inventory_id: string | null
          invoice_date: string | null
          line_nbr: number | null
          montant_ht: number | null
          n_fact: string | null
          pu_rem: number | null
          qty: number | null
          reference_nbr: string | null
          tran_type: string | null
          vendeur: string | null
        }
        Insert: {
          branch?: string | null
          classe_article?: string | null
          classe_client?: string | null
          code_article?: string | null
          code_client?: string | null
          devise?: string | null
          id?: never
          inventory_id?: string | null
          invoice_date?: string | null
          line_nbr?: number | null
          montant_ht?: number | null
          n_fact?: string | null
          pu_rem?: number | null
          qty?: number | null
          reference_nbr?: string | null
          tran_type?: string | null
          vendeur?: string | null
        }
        Update: {
          branch?: string | null
          classe_article?: string | null
          classe_client?: string | null
          code_article?: string | null
          code_client?: string | null
          devise?: string | null
          id?: never
          inventory_id?: string | null
          invoice_date?: string | null
          line_nbr?: number | null
          montant_ht?: number | null
          n_fact?: string | null
          pu_rem?: number | null
          qty?: number | null
          reference_nbr?: string | null
          tran_type?: string | null
          vendeur?: string | null
        }
        Relationships: []
      }
      layout_snapshots: {
        Row: {
          ai_analysis: Json | null
          catalog_used: Json | null
          created_at: string
          equipment_count: number | null
          equipment_placements: Json
          id: string
          manual_adjustments: boolean | null
          project_name: string
          room_area_m2: number | null
          room_geometry: Json
        }
        Insert: {
          ai_analysis?: Json | null
          catalog_used?: Json | null
          created_at?: string
          equipment_count?: number | null
          equipment_placements: Json
          id?: string
          manual_adjustments?: boolean | null
          project_name: string
          room_area_m2?: number | null
          room_geometry: Json
        }
        Update: {
          ai_analysis?: Json | null
          catalog_used?: Json | null
          created_at?: string
          equipment_count?: number | null
          equipment_placements?: Json
          id?: string
          manual_adjustments?: boolean | null
          project_name?: string
          room_area_m2?: number | null
          room_geometry?: Json
        }
        Relationships: []
      }
      logi_expeditions: {
        Row: {
          cout_exw: number | null
          cout_fret: number | null
          created_at: string
          date_dispo_fournisseur: string | null
          docs_transmis: boolean
          eta_le_havre: string | null
          etd: string | null
          fournisseur: string
          heure: string | null
          id: string
          items: Json
          livraison_aa: string | null
          monnayeurs: string | null
          nom_navire: string | null
          numero_commande: string
          numero_conteneur: string | null
          numero_dossier: string | null
          origine: string | null
          port_depart: string | null
          remarques: string | null
          statut: string
          transitaire: string | null
          type_conteneur: string | null
          updated_at: string
        }
        Insert: {
          cout_exw?: number | null
          cout_fret?: number | null
          created_at?: string
          date_dispo_fournisseur?: string | null
          docs_transmis?: boolean
          eta_le_havre?: string | null
          etd?: string | null
          fournisseur: string
          heure?: string | null
          id?: string
          items?: Json
          livraison_aa?: string | null
          monnayeurs?: string | null
          nom_navire?: string | null
          numero_commande: string
          numero_conteneur?: string | null
          numero_dossier?: string | null
          origine?: string | null
          port_depart?: string | null
          remarques?: string | null
          statut?: string
          transitaire?: string | null
          type_conteneur?: string | null
          updated_at?: string
        }
        Update: {
          cout_exw?: number | null
          cout_fret?: number | null
          created_at?: string
          date_dispo_fournisseur?: string | null
          docs_transmis?: boolean
          eta_le_havre?: string | null
          etd?: string | null
          fournisseur?: string
          heure?: string | null
          id?: string
          items?: Json
          livraison_aa?: string | null
          monnayeurs?: string | null
          nom_navire?: string | null
          numero_commande?: string
          numero_conteneur?: string | null
          numero_dossier?: string | null
          origine?: string | null
          port_depart?: string | null
          remarques?: string | null
          statut?: string
          transitaire?: string | null
          type_conteneur?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          copilote_enabled: boolean
          created_at: string
          dashboard_enabled: boolean
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          copilote_enabled?: boolean
          created_at?: string
          dashboard_enabled?: boolean
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          copilote_enabled?: boolean
          created_at?: string
          dashboard_enabled?: boolean
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          brand_id: string | null
          brief: string | null
          client_contact: string | null
          client_name: string
          context: Json
          created_at: string
          created_by: string | null
          id: string
          is_shared: boolean
          offer: string
          owner_id: string | null
          plan_data: Json | null
          plan_snapshot_id: string | null
          pricing: Json
          scope: Json
          selected_modules: Json
          selected_products: Json
          share_password: string | null
          share_slug: string | null
          share_token: string | null
          share_visibility: string
          solution: Json
          status: string
          updated_at: string
          views_seen_at: string | null
        }
        Insert: {
          brand_id?: string | null
          brief?: string | null
          client_contact?: string | null
          client_name?: string
          context?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_shared?: boolean
          offer?: string
          owner_id?: string | null
          plan_data?: Json | null
          plan_snapshot_id?: string | null
          pricing?: Json
          scope?: Json
          selected_modules?: Json
          selected_products?: Json
          share_password?: string | null
          share_slug?: string | null
          share_token?: string | null
          share_visibility?: string
          solution?: Json
          status?: string
          updated_at?: string
          views_seen_at?: string | null
        }
        Update: {
          brand_id?: string | null
          brief?: string | null
          client_contact?: string | null
          client_name?: string
          context?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_shared?: boolean
          offer?: string
          owner_id?: string | null
          plan_data?: Json | null
          plan_snapshot_id?: string | null
          pricing?: Json
          scope?: Json
          selected_modules?: Json
          selected_products?: Json
          share_password?: string | null
          share_slug?: string | null
          share_token?: string | null
          share_visibility?: string
          solution?: Json
          status?: string
          updated_at?: string
          views_seen_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_sessions: {
        Row: {
          created_at: string
          current_style: Json | null
          id: string
          locked_elements: Json | null
          messages: Json
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          current_style?: Json | null
          id?: string
          locked_elements?: Json | null
          messages?: Json
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          current_style?: Json | null
          id?: string
          locked_elements?: Json | null
          messages?: Json
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scene_revisions: {
        Row: {
          actions_applied: Json | null
          asset_list: Json | null
          created_at: string
          generated_summary: string | null
          id: string
          placement_data: Json | null
          scene_snapshot: Json | null
          session_id: string
        }
        Insert: {
          actions_applied?: Json | null
          asset_list?: Json | null
          created_at?: string
          generated_summary?: string | null
          id?: string
          placement_data?: Json | null
          scene_snapshot?: Json | null
          session_id: string
        }
        Update: {
          actions_applied?: Json | null
          asset_list?: Json | null
          created_at?: string
          generated_summary?: string | null
          id?: string
          placement_data?: Json | null
          scene_snapshot?: Json | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_revisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_stats_cache: {
        Row: {
          created_at: string
          data: Json
          fetched_at: string
          id: string
          period: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          fetched_at?: string
          id?: string
          period?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          fetched_at?: string
          id?: string
          period?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_token_cache: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          shop_domain: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          shop_domain: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          shop_domain?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_sync_log: {
        Row: {
          cegid_code: string | null
          created_at: string
          delta: number | null
          id: string
          message: string | null
          product_name: string | null
          qty_after: number | null
          qty_before: number | null
          shopify_variant_id: string | null
          status: string
          triggered_by: string | null
        }
        Insert: {
          cegid_code?: string | null
          created_at?: string
          delta?: number | null
          id?: string
          message?: string | null
          product_name?: string | null
          qty_after?: number | null
          qty_before?: number | null
          shopify_variant_id?: string | null
          status: string
          triggered_by?: string | null
        }
        Update: {
          cegid_code?: string | null
          created_at?: string
          delta?: number | null
          id?: string
          message?: string | null
          product_name?: string | null
          qty_after?: number | null
          qty_before?: number | null
          shopify_variant_id?: string | null
          status?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          role: string
          user_id: string
        }
        Insert: {
          role?: string
          user_id: string
        }
        Update: {
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      veille_rapports: {
        Row: {
          contenu_json: Json | null
          contenu_markdown: string
          created_at: string
          id: string
          periode: string
          sources: Json
          type: string
        }
        Insert: {
          contenu_json?: Json | null
          contenu_markdown: string
          created_at?: string
          id?: string
          periode: string
          sources?: Json
          type: string
        }
        Update: {
          contenu_json?: Json | null
          contenu_markdown?: string
          created_at?: string
          id?: string
          periode?: string
          sources?: Json
          type?: string
        }
        Relationships: []
      }
      zendesk_stats_cache: {
        Row: {
          cache_version: number
          created_at: string
          fetched_at: string
          id: string
          payload: Json
          period_key: string
          updated_at: string
        }
        Insert: {
          cache_version?: number
          created_at?: string
          fetched_at?: string
          id?: string
          payload: Json
          period_key?: string
          updated_at?: string
        }
        Update: {
          cache_version?: number
          created_at?: string
          fetched_at?: string
          id?: string
          payload?: Json
          period_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      zendesk_ticket_summaries: {
        Row: {
          created_at: string
          model: string | null
          resume: Json
          ticket_id: number
          ticket_updated_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          model?: string | null
          resume: Json
          ticket_id: number
          ticket_updated_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          model?: string | null
          resume?: Json
          ticket_id?: number
          ticket_updated_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_gaia_article_famille: {
        Row: {
          code: string | null
          famille: string | null
        }
        Relationships: []
      }
      v_gaia_articles: {
        Row: {
          code: string | null
          description: string | null
          famille: string | null
          prix_ht: number | null
          stock: number | null
        }
        Relationships: []
      }
      v_gaia_ca_client: {
        Row: {
          annee: number | null
          ca_ht: number | null
          client: string | null
          code_client: string | null
        }
        Relationships: []
      }
      v_gaia_ca_famille: {
        Row: {
          annee: number | null
          ca_ht: number | null
          famille: string | null
        }
        Relationships: []
      }
      v_gaia_ca_mensuel: {
        Row: {
          annee: number | null
          ca_ht: number | null
          lignes: number | null
          mois: string | null
          mois_calendaire: number | null
          mois_fiscal: number | null
        }
        Relationships: []
      }
      v_gaia_ca_periode_egale: {
        Row: {
          annee: number | null
          ca_ht: number | null
        }
        Relationships: []
      }
      v_gaia_carnet_documents: {
        Row: {
          age_mois: number | null
          categorie: string | null
          client: string | null
          code_client: string | null
          date_document: string | null
          n_cde: string | null
          nb_lignes: number | null
          order_type: string | null
          origine: string | null
          sfa: boolean | null
          statut: string | null
          total_ht: number | null
        }
        Relationships: []
      }
      v_gaia_clients_dormants: {
        Row: {
          ca_annee_courante: number | null
          ca_n1: number | null
          ca_n2: number | null
          client: string | null
          code_client: string | null
          derniere_facture: string | null
        }
        Relationships: []
      }
      v_gaia_commandes_etat: {
        Row: {
          etat: string | null
          nb_commandes: number | null
          total_ht: number | null
        }
        Relationships: []
      }
      v_gaia_cout_article: {
        Row: {
          code: string | null
          cout_unitaire: number | null
          famille: string | null
        }
        Relationships: []
      }
      v_gaia_devis_a_relancer: {
        Row: {
          age_jours: number | null
          client: string | null
          code_client: string | null
          date_devis: string | null
          montant_ht: number | null
          n_cde: string | null
        }
        Relationships: []
      }
      v_gaia_ecotax_codes: {
        Row: {
          code: string | null
        }
        Relationships: []
      }
      v_gaia_ecotaxe_mensuel: {
        Row: {
          ecotaxe_ht: number | null
          mois: string | null
        }
        Relationships: []
      }
      v_gaia_excluded_clients: {
        Row: {
          code: string | null
        }
        Relationships: []
      }
      v_gaia_lignes: {
        Row: {
          classe_article: string | null
          code_article: string | null
          code_client: string | null
          inventory_id: string | null
          invoice_date: string | null
          montant_ht: number | null
          qty: number | null
          source: string | null
        }
        Relationships: []
      }
      v_gaia_magasin_carnet: {
        Row: {
          categorie: string | null
          nb: number | null
          sfa: boolean | null
          statut: string | null
          total_ht: number | null
        }
        Relationships: []
      }
      v_gaia_magasin_marge: {
        Row: {
          annee: number | null
          ca_avec_cout: number | null
          ca_ht: number | null
          marge_estimee: number | null
        }
        Relationships: []
      }
      v_gaia_magasin_mensuel: {
        Row: {
          annee: number | null
          ca_ht: number | null
          clients: number | null
          lignes: number | null
          mois: string | null
        }
        Relationships: []
      }
      v_gaia_magasin_ruptures: {
        Row: {
          ca_6m: number | null
          code: string | null
          description: string | null
          qte_vendue_6m: number | null
          qty_disponible: number | null
          sous_famille: string | null
        }
        Relationships: []
      }
      v_gaia_magasin_sous_familles: {
        Row: {
          annee: number | null
          ca_ht: number | null
          refs: number | null
          sous_famille: string | null
        }
        Relationships: []
      }
      v_gaia_magasin_stock_valeur: {
        Row: {
          quantite: number | null
          refs: number | null
          valeur_achat: number | null
          valeur_vente: number | null
        }
        Relationships: []
      }
      v_gaia_magasin_top_articles: {
        Row: {
          annee: number | null
          ca_ht: number | null
          code_article: string | null
          description: string | null
          quantite: number | null
        }
        Relationships: []
      }
      v_gaia_magasin_top_clients: {
        Row: {
          annee: number | null
          ca_ht: number | null
          client: string | null
          code_client: string | null
          lignes: number | null
        }
        Relationships: []
      }
      v_gaia_marge_client: {
        Row: {
          annee: number | null
          ca_avec_cout: number | null
          ca_ht: number | null
          client: string | null
          marge_estimee: number | null
        }
        Relationships: []
      }
      v_gaia_marge_famille: {
        Row: {
          annee: number | null
          ca_avec_cout: number | null
          ca_ht: number | null
          cout_estime: number | null
          famille: string | null
          marge_estimee: number | null
        }
        Relationships: []
      }
      v_gaia_parc_client: {
        Row: {
          client: string | null
          code_article: string | null
          code_client: string | null
          derniere_vente: string | null
          description: string | null
          famille: string | null
          quantite: number | null
        }
        Relationships: []
      }
      v_gaia_pipeline: {
        Row: {
          categorie: string | null
          nb: number | null
          sfa: boolean | null
          statut: string | null
          total_ht: number | null
        }
        Relationships: []
      }
      v_gaia_retrocession_sfa: {
        Row: {
          annee: number | null
          mois: string | null
          montant_ht: number | null
        }
        Relationships: []
      }
      v_gaia_stock_dormant: {
        Row: {
          code_article: string | null
          description: string | null
          famille: string | null
          quantite: number | null
          valeur_achat: number | null
        }
        Relationships: []
      }
      v_gaia_stock_valeur: {
        Row: {
          depot: string | null
          quantite: number | null
          valeur_achat: number | null
          valeur_vente: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_access_dashboard: { Args: { _uid?: string }; Returns: boolean }
      gaia_query: { Args: { sql_query: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_direction: { Args: never; Returns: boolean }
      refresh_erp_prices: { Args: never; Returns: number }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
