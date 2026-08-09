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
      project_members: {
        Row: {
          joined_at: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          joined_at?: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          joined_at?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_modules: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          project_id: string
          sort_position: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          project_id: string
          sort_position: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_position?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_modules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_modules_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_modules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_modules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          idempotency_key: string
          lead_id: string | null
          module_preset_initialized: boolean
          name: string
          owner_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          idempotency_key: string
          lead_id?: string | null
          module_preset_initialized?: boolean
          name: string
          owner_id: string
          project_type?: Database["public"]["Enums"]["project_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          idempotency_key?: string
          lead_id?: string | null
          module_preset_initialized?: boolean
          name?: string
          owner_id?: string
          project_type?: Database["public"]["Enums"]["project_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_collaborators: {
        Row: {
          created_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_collaborators_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_status_history: {
        Row: {
          action: Database["public"]["Enums"]["task_status_action"]
          actor_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["task_status"]
          id: string
          idempotency_key: string
          reason: string | null
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
          transition_seq: number
        }
        Insert: {
          action: Database["public"]["Enums"]["task_status_action"]
          actor_id: string
          created_at?: string
          from_status: Database["public"]["Enums"]["task_status"]
          id?: string
          idempotency_key: string
          reason?: string | null
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
          transition_seq: number
        }
        Update: {
          action?: Database["public"]["Enums"]["task_status_action"]
          actor_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["task_status"]
          id?: string
          idempotency_key?: string
          reason?: string | null
          task_id?: string
          to_status?: Database["public"]["Enums"]["task_status"]
          transition_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_status_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_status_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_visibility_users: {
        Row: {
          created_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_visibility_users_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_visibility_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          acceptance_criteria: string | null
          assignee_id: string
          blocked_at: string | null
          blocked_by: string | null
          blocker_reason: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          idempotency_key: string
          module_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          reviewer_id: string
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          updated_by: string
          visibility: Database["public"]["Enums"]["task_visibility"]
          workload_level: Database["public"]["Enums"]["task_workload_level"]
        }
        Insert: {
          acceptance_criteria?: string | null
          assignee_id: string
          blocked_at?: string | null
          blocked_by?: string | null
          blocker_reason?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          idempotency_key: string
          module_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          project_id: string
          reviewer_id: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          updated_by: string
          visibility?: Database["public"]["Enums"]["task_visibility"]
          workload_level?: Database["public"]["Enums"]["task_workload_level"]
        }
        Update: {
          acceptance_criteria?: string | null
          assignee_id?: string
          blocked_at?: string | null
          blocked_by?: string | null
          blocker_reason?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          idempotency_key?: string
          module_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          project_id?: string
          reviewer_id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          updated_by?: string
          visibility?: Database["public"]["Enums"]["task_visibility"]
          workload_level?: Database["public"]["Enums"]["task_workload_level"]
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_module_project_fkey"
            columns: ["module_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_modules"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
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
      add_project_member: {
        Args: {
          p_project_id: string
          p_role: Database["public"]["Enums"]["project_role"]
          p_user_id: string
        }
        Returns: {
          archived_at: string
          changed: boolean
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      add_project_module: {
        Args: { p_name: string; p_project_id: string }
        Returns: {
          created_at: string
          created_by: string
          module_id: string
          name: string
          project_id: string
          sort_position: number
          updated_at: string
          updated_by: string
        }[]
      }
      archive_project: {
        Args: { p_expected_updated_at: string; p_project_id: string }
        Returns: {
          archived_at: string
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      assert_active_project_candidate: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: undefined
      }
      assert_task_candidate: {
        Args: {
          p_project_id: string
          p_responsibility: boolean
          p_user_id: string
        }
        Returns: undefined
      }
      block_task: {
        Args: {
          p_blocker_reason: string
          p_idempotency_key: string
          p_task_id: string
        }
        Returns: Json
      }
      bootstrap_default_workspace: {
        Args: { p_idempotency_key: string; p_name: string; p_owner_id: string }
        Returns: string
      }
      can_manage_project_leadership: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_manage_project_members: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_manage_project_tasks: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      can_manage_workspace_members: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      can_manage_workspace_projects: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      can_read_project: { Args: { p_project_id: string }; Returns: boolean }
      can_read_task: { Args: { p_task_id: string }; Returns: boolean }
      cancel_task: {
        Args: { p_idempotency_key: string; p_task_id: string }
        Returns: Json
      }
      clear_project_lead: {
        Args: { p_expected_updated_at: string; p_project_id: string }
        Returns: {
          archived_at: string
          changed: boolean
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      confirm_workspace_auth_invitation_result: {
        Args: {
          p_invitation_id: string
          p_operation_kind: string
          p_provider_subject: string
          p_provider_tenant: string
        }
        Returns: string
      }
      create_project:
        | {
            Args: {
              p_description: string
              p_due_date: string
              p_idempotency_key: string
              p_initial_status: Database["public"]["Enums"]["project_status"]
              p_name: string
              p_project_type: Database["public"]["Enums"]["project_type"]
              p_start_date: string
              p_workspace_id: string
            }
            Returns: {
              archived_at: string
              created_at: string
              created_by: string
              description: string
              due_date: string
              lead_display_name: string
              lead_id: string
              name: string
              owner_display_name: string
              owner_id: string
              project_id: string
              project_type: Database["public"]["Enums"]["project_type"]
              start_date: string
              status: Database["public"]["Enums"]["project_status"]
              updated_at: string
              was_existing: boolean
              workspace_id: string
            }[]
          }
        | {
            Args: {
              p_description: string
              p_due_date: string
              p_idempotency_key: string
              p_initial_status: Database["public"]["Enums"]["project_status"]
              p_initialize_modules: boolean
              p_name: string
              p_project_type: Database["public"]["Enums"]["project_type"]
              p_start_date: string
              p_workspace_id: string
            }
            Returns: {
              archived_at: string
              created_at: string
              created_by: string
              description: string
              due_date: string
              lead_display_name: string
              lead_id: string
              name: string
              owner_display_name: string
              owner_id: string
              project_id: string
              project_type: Database["public"]["Enums"]["project_type"]
              start_date: string
              status: Database["public"]["Enums"]["project_status"]
              updated_at: string
              was_existing: boolean
              workspace_id: string
            }[]
          }
      create_task: {
        Args: {
          p_acceptance_criteria: string
          p_assignee_id: string
          p_collaborator_ids: string[]
          p_description: string
          p_due_date: string
          p_estimated_hours: number
          p_idempotency_key: string
          p_module_id: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_project_id: string
          p_reviewer_id: string
          p_start_date: string
          p_title: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
          p_visibility_user_ids: string[]
          p_workload_level: Database["public"]["Enums"]["task_workload_level"]
        }
        Returns: {
          acceptance_criteria: string
          assignee_display_name: string
          assignee_id: string
          collaborators: Json
          created_at: string
          created_by: string
          description: string
          due_date: string
          estimated_hours: number
          module_id: string
          module_name: string
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          reviewer_display_name: string
          reviewer_id: string
          start_date: string
          status: Database["public"]["Enums"]["task_status"]
          task_id: string
          title: string
          updated_at: string
          updated_by: string
          visibility: Database["public"]["Enums"]["task_visibility"]
          visibility_users: Json
          was_existing: boolean
          workload_level: Database["public"]["Enums"]["task_workload_level"]
          workspace_id: string
        }[]
      }
      current_app_user_id: { Args: never; Returns: string }
      delete_project_module: {
        Args: { p_module_id: string; p_project_id: string }
        Returns: {
          created_at: string
          created_by: string
          module_id: string
          name: string
          project_id: string
          sort_position: number
          updated_at: string
          updated_by: string
        }[]
      }
      execute_task_transition: {
        Args: {
          p_action: Database["public"]["Enums"]["task_status_action"]
          p_idempotency_key: string
          p_reason: string
          p_task_id: string
        }
        Returns: Json
      }
      get_project: {
        Args: { p_project_id: string }
        Returns: {
          archived_at: string
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      get_task: {
        Args: { p_task_id: string }
        Returns: {
          acceptance_criteria: string
          assignee_display_name: string
          assignee_id: string
          blocked_at: string
          blocked_by: string
          blocked_by_display_name: string
          blocker_reason: string
          collaborators: Json
          created_at: string
          created_by: string
          description: string
          due_date: string
          estimated_hours: number
          module_id: string
          module_name: string
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          reviewer_display_name: string
          reviewer_id: string
          start_date: string
          status: Database["public"]["Enums"]["task_status"]
          task_id: string
          title: string
          updated_at: string
          updated_by: string
          visibility: Database["public"]["Enums"]["task_visibility"]
          visibility_users: Json
          workload_level: Database["public"]["Enums"]["task_workload_level"]
          workspace_id: string
        }[]
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
      list_project_member_candidates: {
        Args: { p_project_id: string }
        Returns: {
          app_user_id: string
          display_name: string
          existing_project_role: Database["public"]["Enums"]["project_role"]
          project_id: string
          workspace_id: string
          workspace_role: Database["public"]["Enums"]["workspace_role"]
        }[]
      }
      list_project_members: {
        Args: { p_project_id: string }
        Returns: {
          active_member_count: number
          app_user_id: string
          display_name: string
          inactive_historical_member_count: number
          is_active: boolean
          is_current_user: boolean
          joined_at: string
          project_id: string
          project_role: Database["public"]["Enums"]["project_role"]
          workspace_id: string
          workspace_role: Database["public"]["Enums"]["workspace_role"]
        }[]
      }
      list_project_modules: {
        Args: { p_project_id: string }
        Returns: {
          created_at: string
          created_by: string
          module_id: string
          name: string
          project_id: string
          sort_position: number
          updated_at: string
          updated_by: string
        }[]
      }
      list_project_tasks: {
        Args: { p_project_id: string }
        Returns: {
          assignee_display_name: string
          assignee_id: string
          collaborators: Json
          due_date: string
          estimated_hours: number
          module_id: string
          module_name: string
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          start_date: string
          status: Database["public"]["Enums"]["task_status"]
          task_id: string
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["task_visibility"]
          workload_level: Database["public"]["Enums"]["task_workload_level"]
          workspace_id: string
        }[]
      }
      list_projects: {
        Args: {
          p_archived_only?: boolean
          p_search?: string
          p_status?: Database["public"]["Enums"]["project_status"]
          p_workspace_id: string
        }
        Returns: {
          archived_at: string
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      list_task_assignment_candidates: {
        Args: { p_project_id: string }
        Returns: {
          app_user_id: string
          can_hold_responsibility: boolean
          display_name: string
          project_id: string
          project_role: Database["public"]["Enums"]["project_role"]
          workspace_id: string
        }[]
      }
      list_task_status_history: {
        Args: { p_task_id: string }
        Returns: {
          action: Database["public"]["Enums"]["task_status_action"]
          actor_display_name: string
          actor_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["task_status"]
          reason: string
          sequence: number
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
          transition_id: string
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
      lock_membership_participants: {
        Args: { p_participant_ids?: string[]; p_project_id: string }
        Returns: undefined
      }
      lock_project_for_module_write: {
        Args: { p_project_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          idempotency_key: string
          lead_id: string | null
          module_preset_initialized: boolean
          name: string
          owner_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_task_write_participants: {
        Args: { p_participant_ids: string[]; p_project_id: string }
        Returns: undefined
      }
      lock_workspace_project_creator: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      mark_workspace_invitation_failed: {
        Args: { p_failure_code: string; p_invitation_id: string }
        Returns: Database["public"]["Enums"]["workspace_invitation_status"]
      }
      normalize_project_module_name: {
        Args: { p_name: string }
        Returns: string
      }
      operations_project_module_presets: {
        Args: never
        Returns: {
          module_name: string
          sort_position: number
        }[]
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
      project_module_snapshot: {
        Args: { p_project_id: string }
        Returns: {
          created_at: string
          created_by: string
          module_id: string
          name: string
          project_id: string
          sort_position: number
          updated_at: string
          updated_by: string
        }[]
      }
      project_role_for_current_user: {
        Args: { p_project_id: string }
        Returns: Database["public"]["Enums"]["project_role"]
      }
      project_snapshot: {
        Args: { p_project_id: string }
        Returns: {
          archived_at: string
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      remove_project_member: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: {
          archived_at: string
          changed: boolean
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      rename_project_module: {
        Args: { p_module_id: string; p_name: string; p_project_id: string }
        Returns: {
          created_at: string
          created_by: string
          module_id: string
          name: string
          project_id: string
          sort_position: number
          updated_at: string
          updated_by: string
        }[]
      }
      reorder_project_modules: {
        Args: { p_module_ids: string[]; p_project_id: string }
        Returns: {
          created_at: string
          created_by: string
          module_id: string
          name: string
          project_id: string
          sort_position: number
          updated_at: string
          updated_by: string
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
      resume_task: {
        Args: { p_idempotency_key: string; p_task_id: string }
        Returns: Json
      }
      set_project_lead: {
        Args: {
          p_expected_updated_at: string
          p_project_id: string
          p_user_id: string
        }
        Returns: {
          archived_at: string
          changed: boolean
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      set_project_member_role: {
        Args: {
          p_project_id: string
          p_role: Database["public"]["Enums"]["project_role"]
          p_user_id: string
        }
        Returns: {
          archived_at: string
          changed: boolean
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
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
      start_task: {
        Args: { p_idempotency_key: string; p_task_id: string }
        Returns: Json
      }
      task_snapshot: {
        Args: { p_task_id: string }
        Returns: {
          acceptance_criteria: string
          assignee_display_name: string
          assignee_id: string
          collaborators: Json
          created_at: string
          created_by: string
          description: string
          due_date: string
          estimated_hours: number
          module_id: string
          module_name: string
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          reviewer_display_name: string
          reviewer_id: string
          start_date: string
          status: Database["public"]["Enums"]["task_status"]
          task_id: string
          title: string
          updated_at: string
          updated_by: string
          visibility: Database["public"]["Enums"]["task_visibility"]
          visibility_users: Json
          workload_level: Database["public"]["Enums"]["task_workload_level"]
          workspace_id: string
        }[]
      }
      task_status_snapshot: {
        Args: { p_task_id: string }
        Returns: {
          acceptance_criteria: string
          assignee_display_name: string
          assignee_id: string
          blocked_at: string
          blocked_by: string
          blocked_by_display_name: string
          blocker_reason: string
          collaborators: Json
          created_at: string
          created_by: string
          description: string
          due_date: string
          estimated_hours: number
          module_id: string
          module_name: string
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          reviewer_display_name: string
          reviewer_id: string
          start_date: string
          status: Database["public"]["Enums"]["task_status"]
          task_id: string
          title: string
          updated_at: string
          updated_by: string
          visibility: Database["public"]["Enums"]["task_visibility"]
          visibility_users: Json
          workload_level: Database["public"]["Enums"]["task_workload_level"]
          workspace_id: string
        }[]
      }
      transfer_project_owner: {
        Args: {
          p_expected_updated_at: string
          p_project_id: string
          p_user_id: string
        }
        Returns: {
          archived_at: string
          changed: boolean
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      update_project: {
        Args: {
          p_description: string
          p_due_date: string
          p_expected_updated_at: string
          p_name: string
          p_project_id: string
          p_start_date: string
          p_status: Database["public"]["Enums"]["project_status"]
        }
        Returns: {
          archived_at: string
          created_at: string
          created_by: string
          description: string
          due_date: string
          lead_display_name: string
          lead_id: string
          name: string
          owner_display_name: string
          owner_id: string
          project_id: string
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }[]
      }
      update_task: {
        Args: {
          p_acceptance_criteria: string
          p_assignee_id: string
          p_collaborator_ids: string[]
          p_description: string
          p_due_date: string
          p_estimated_hours: number
          p_expected_updated_at: string
          p_module_id: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_project_id: string
          p_reviewer_id: string
          p_start_date: string
          p_task_id: string
          p_title: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
          p_visibility_user_ids: string[]
          p_workload_level: Database["public"]["Enums"]["task_workload_level"]
        }
        Returns: {
          acceptance_criteria: string
          assignee_display_name: string
          assignee_id: string
          collaborators: Json
          created_at: string
          created_by: string
          description: string
          due_date: string
          estimated_hours: number
          module_id: string
          module_name: string
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          reviewer_display_name: string
          reviewer_id: string
          start_date: string
          status: Database["public"]["Enums"]["task_status"]
          task_id: string
          title: string
          updated_at: string
          updated_by: string
          visibility: Database["public"]["Enums"]["task_visibility"]
          visibility_users: Json
          workload_level: Database["public"]["Enums"]["task_workload_level"]
          workspace_id: string
        }[]
      }
      validate_task_write_input: {
        Args: {
          p_assignee_id: string
          p_collaborator_ids: string[]
          p_project_id: string
          p_reviewer_id: string
          p_visibility: Database["public"]["Enums"]["task_visibility"]
          p_visibility_user_ids: string[]
        }
        Returns: undefined
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
      project_role: "owner" | "lead" | "member" | "viewer"
      project_status:
        | "planning"
        | "active"
        | "paused"
        | "completed"
        | "archived"
      project_type: "operations"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status:
        | "todo"
        | "in_progress"
        | "blocked"
        | "pending_review"
        | "completed"
        | "cancelled"
      task_status_action: "start" | "block" | "resume" | "cancel"
      task_visibility: "project" | "restricted"
      task_workload_level: "xs" | "s" | "m" | "l" | "xl"
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
      project_role: ["owner", "lead", "member", "viewer"],
      project_status: ["planning", "active", "paused", "completed", "archived"],
      project_type: ["operations"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: [
        "todo",
        "in_progress",
        "blocked",
        "pending_review",
        "completed",
        "cancelled",
      ],
      task_status_action: ["start", "block", "resume", "cancel"],
      task_visibility: ["project", "restricted"],
      task_workload_level: ["xs", "s", "m", "l", "xl"],
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
