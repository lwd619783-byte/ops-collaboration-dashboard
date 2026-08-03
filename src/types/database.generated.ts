export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_users: {
        Row: {
          created_at: string
          disabled_at: string | null
          id: string
          merged_into_user_id: string | null
          status: Database["public"]["Enums"]["app_user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          merged_into_user_id?: string | null
          status?: Database["public"]["Enums"]["app_user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          merged_into_user_id?: string | null
          status?: Database["public"]["Enums"]["app_user_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_merged_into_user_id_fkey"
            columns: ["merged_into_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_binding_challenges: {
        Row: {
          attempt_count: number
          challenge_hash: string
          consumed_at: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_attempts: number
          provider: Database["public"]["Enums"]["identity_provider"]
          provider_tenant: string
          target_user_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          challenge_hash: string
          consumed_at?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          max_attempts?: number
          provider: Database["public"]["Enums"]["identity_provider"]
          provider_tenant: string
          target_user_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          challenge_hash?: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          provider?: Database["public"]["Enums"]["identity_provider"]
          provider_tenant?: string
          target_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_binding_challenges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_binding_challenges_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          contact_info: Json | null
          created_at: string
          display_name: string
          organization_name: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          contact_info?: Json | null
          created_at?: string
          display_name: string
          organization_name?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          contact_info?: Json | null
          created_at?: string
          display_name?: string
          organization_name?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_identities: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          provider: Database["public"]["Enums"]["identity_provider"]
          provider_subject: string
          provider_tenant: string
          revoked_at: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          provider: Database["public"]["Enums"]["identity_provider"]
          provider_subject: string
          provider_tenant: string
          revoked_at?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          provider?: Database["public"]["Enums"]["identity_provider"]
          provider_subject?: string
          provider_tenant?: string
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          display_name: string
          email_hash: string
          email_hint: string
          expires_at: string
          failed_at: string | null
          failure_code: string | null
          id: string
          idempotency_key: string
          invited_by: string
          invitee_user_id: string | null
          reissue_of_invitation_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          sent_at: string | null
          status: Database["public"]["Enums"]["workspace_invitation_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          display_name: string
          email_hash: string
          email_hint: string
          expires_at: string
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          idempotency_key: string
          invited_by: string
          invitee_user_id?: string | null
          reissue_of_invitation_id?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["workspace_invitation_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          display_name?: string
          email_hash?: string
          email_hint?: string
          expires_at?: string
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          idempotency_key?: string
          invited_by?: string
          invitee_user_id?: string | null
          reissue_of_invitation_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["workspace_invitation_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_invitee_user_id_fkey"
            columns: ["invitee_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_reissue_of_invitation_id_fkey"
            columns: ["reissue_of_invitation_id"]
            isOneToOne: false
            referencedRelation: "workspace_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          disabled_at: string | null
          invited_by: string
          joined_at: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_member_status"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          invited_by: string
          joined_at?: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_member_status"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          invited_by?: string
          joined_at?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["workspace_member_status"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          bootstrap_key: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          bootstrap_key?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          bootstrap_key?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_workspace_invitation: {
        Args: { p_invitation_id: string }
        Returns: {
          already_accepted: boolean
          invitation_id: string
          membership_status: Database["public"]["Enums"]["workspace_member_status"]
          workspace_id: string
        }[]
      }
      bootstrap_default_workspace: {
        Args: { p_idempotency_key: string; p_name: string; p_owner_id: string }
        Returns: string
      }
      can_manage_workspace_members: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      current_app_user_id: { Args: never; Returns: string }
      finalize_workspace_invitation_reissue: {
        Args: {
          p_invitation_id: string
          p_provider_subject: string
          p_provider_tenant: string
        }
        Returns: Database["public"]["Enums"]["workspace_invitation_status"]
      }
      health_check: {
        Args: never
        Returns: {
          checked_at: string
          status: string
        }[]
      }
      is_active_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      list_my_pending_workspace_invitations: {
        Args: never
        Returns: {
          expires_at: string
          invitation_id: string
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_invitation_status"]
          workspace_id: string
          workspace_name: string
        }[]
      }
      list_my_workspaces: {
        Args: never
        Returns: {
          joined_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_member_status"]
          workspace_id: string
          workspace_name: string
        }[]
      }
      list_workspace_members: {
        Args: { p_workspace_id: string }
        Returns: {
          avatar_url: string
          disabled_at: string
          display_name: string
          joined_at: string
          organization_name: string
          pending_invitation: boolean
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_member_status"]
          title: string
          user_id: string
        }[]
      }
      mark_workspace_invitation_failed: {
        Args: { p_failure_code: string; p_invitation_id: string }
        Returns: Database["public"]["Enums"]["workspace_invitation_status"]
      }
      prepare_workspace_invitation: {
        Args: {
          p_display_name: string
          p_email_hash: string
          p_email_hint: string
          p_idempotency_key: string
          p_role: Database["public"]["Enums"]["workspace_role"]
          p_workspace_id: string
        }
        Returns: {
          invitation_id: string
          invitation_status: Database["public"]["Enums"]["workspace_invitation_status"]
          operation_kind: string
          should_send: boolean
        }[]
      }
      resolve_app_user_id: {
        Args: {
          p_provider: Database["public"]["Enums"]["identity_provider"]
          p_subject: string
          p_tenant: string
        }
        Returns: string
      }
      set_workspace_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["workspace_role"]
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_member_status"]
          user_id: string
        }[]
      }
      set_workspace_member_status: {
        Args: {
          p_status: Database["public"]["Enums"]["workspace_member_status"]
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          disabled_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["workspace_member_status"]
          user_id: string
        }[]
      }
      workspace_invitation_ttl_seconds: { Args: never; Returns: number }
      workspace_role_for_current_user: {
        Args: { p_workspace_id: string }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
    }
    Enums: {
      app_user_status: "invited" | "active" | "suspended" | "merged"
      identity_provider:
        | "supabase_auth"
        | "wechat_miniprogram"
        | "enterprise_wechat"
      workspace_invitation_status:
        | "prepared"
        | "reissue_prepared"
        | "sent"
        | "accepted"
        | "failed"
        | "revoked"
      workspace_member_status: "invited" | "active" | "suspended"
      workspace_role: "owner" | "admin" | "member" | "external_collaborator"
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
    Enums: {
      app_user_status: ["invited", "active", "suspended", "merged"],
      identity_provider: [
        "supabase_auth",
        "wechat_miniprogram",
        "enterprise_wechat",
      ],
      workspace_invitation_status: [
        "prepared",
        "reissue_prepared",
        "sent",
        "accepted",
        "failed",
        "revoked",
      ],
      workspace_member_status: ["invited", "active", "suspended"],
      workspace_role: ["owner", "admin", "member", "external_collaborator"],
    },
  },
} as const
