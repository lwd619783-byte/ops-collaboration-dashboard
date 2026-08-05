import type { Database } from '@/types/database.generated'

export type ProjectType = Database['public']['Enums']['project_type']
export type ProjectStatus = Database['public']['Enums']['project_status']
export type ProjectRole = Database['public']['Enums']['project_role']

type GeneratedProject =
  Database['public']['Functions']['list_projects']['Returns'][number]

export type Project = Omit<
  GeneratedProject,
  | 'archived_at'
  | 'description'
  | 'due_date'
  | 'lead_display_name'
  | 'lead_id'
  | 'start_date'
> & {
  archived_at: string | null
  description: string | null
  due_date: string | null
  lead_display_name: string | null
  lead_id: string | null
  start_date: string | null
}

export type ProjectCreateInput = {
  workspaceId: string
  name: string
  description: string
  projectType: ProjectType
  initialStatus: Extract<ProjectStatus, 'planning' | 'active'>
  startDate: string | null
  dueDate: string | null
  idempotencyKey: string
}

export type ProjectUpdateInput = {
  projectId: string
  name: string
  description: string
  status: Exclude<ProjectStatus, 'archived'>
  startDate: string | null
  dueDate: string | null
  expectedUpdatedAt: string
}

export type ProjectListInput = {
  workspaceId: string
  archivedOnly?: boolean
  status?: ProjectStatus
  search?: string
}

export type ProjectFormValues = {
  name: string
  description: string
  projectType: ProjectType
  status: Exclude<ProjectStatus, 'archived'>
  startDate: string
  dueDate: string
}
