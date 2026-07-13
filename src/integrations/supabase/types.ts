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
          name: string
          player_clearance: number | null
          pmr_accessible: boolean | null
          price: number | null
          price_monthly: number | null
          product_url: string | null
          safety_zone: number
          shopify_id: string | null
          specs: Json | null
          stock: string | null
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
          name: string
          player_clearance?: number | null
          pmr_accessible?: boolean | null
          price?: number | null
          price_monthly?: number | null
          product_url?: string | null
          safety_zone?: number
          shopify_id?: string | null
          specs?: Json | null
          stock?: string | null
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
          name?: string
          player_clearance?: number | null
          pmr_accessible?: boolean | null
          price?: number | null
          price_monthly?: number | null
          product_url?: string | null
          safety_zone?: number
          shopify_id?: string | null
          specs?: Json | null
          stock?: string | null
          tags?: string[] | null
          updated_at?: string
          vendor?: string | null
          video_url?: string | null
          warranty?: string | null
          width?: number
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
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
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
