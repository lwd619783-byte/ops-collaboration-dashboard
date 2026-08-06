import type { ProjectFormValues } from '@/features/projects/types'

export const PROJECT_LIMITS = {
  name: 120,
  description: 2000,
} as const

export const PROJECT_MODULE_LIMITS = {
  name: 120,
} as const

export function normalizeProjectModuleName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function validateProjectModuleName(value: string): string | null {
  const normalized = normalizeProjectModuleName(value)
  if (normalized.length === 0) return '模块名称不能为空。'
  if (normalized.length > PROJECT_MODULE_LIMITS.name) {
    return `模块名称不能超过 ${PROJECT_MODULE_LIMITS.name} 个字符。`
  }
  return null
}

export type ProjectFormErrors = Partial<Record<keyof ProjectFormValues, string>>

export function validateProjectForm(
  values: ProjectFormValues,
): ProjectFormErrors {
  const errors: ProjectFormErrors = {}
  const name = values.name.trim()
  const description = values.description.trim()

  if (name.length === 0) {
    errors.name = '项目名称不能为空。'
  } else if (name.length > PROJECT_LIMITS.name) {
    errors.name = `项目名称不能超过 ${PROJECT_LIMITS.name} 个字符。`
  }
  if (description.length > PROJECT_LIMITS.description) {
    errors.description = `项目描述不能超过 ${PROJECT_LIMITS.description} 个字符。`
  }
  if (values.projectType !== 'operations') {
    errors.projectType = '当前仅支持运维项目。'
  }
  if (values.startDate && values.dueDate && values.dueDate < values.startDate) {
    errors.dueDate = '截止日期不得早于开始日期。'
  }

  return errors
}
