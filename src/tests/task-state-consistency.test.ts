import { describe, expect, it, vi } from 'vitest'
import {
  isTaskProgressConsistent,
  refreshConsistentTaskState,
  TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
} from '@/features/tasks'
import type {
  Task,
  TaskProgressUpdate,
  TaskStatusHistoryItem,
} from '@/features/tasks'

const TASK_ID = 'cccccccc-1111-4111-8111-111111111111'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const UPDATE_ID = 'dddddddd-1111-4111-8111-111111111111'
const BLOCK_TRANSITION_ID = 'eeeeeeee-1111-4111-8111-111111111111'

const task: Task = {
  task_id: TASK_ID,
  project_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  workspace_id: '99999999-1111-4111-8111-111111111111',
  module_id: 'bbbbbbbb-1111-4111-8111-111111111111',
  module_name: 'Fictional module',
  title: 'Fictional task',
  description: null,
  acceptance_criteria: null,
  assignee_id: USER_ID,
  assignee_display_name: 'Fictional user',
  collaborators: [],
  reviewer_id: USER_ID,
  reviewer_display_name: 'Fictional user',
  priority: 'medium',
  start_date: null,
  due_date: null,
  estimated_hours: null,
  workload_level: 'm',
  visibility: 'project',
  visibility_users: [],
  status: 'in_progress',
  progress: 40,
  last_progress_at: '2026-08-10T02:00:00+00:00',
  last_progress_by: USER_ID,
  last_progress_by_display_name: 'Fictional user',
  blocker_reason: null,
  blocked_at: null,
  blocked_by: null,
  blocked_by_display_name: null,
  created_by: USER_ID,
  created_at: '2026-08-09T01:00:00+00:00',
  updated_by: USER_ID,
  updated_at: '2026-08-10T02:00:00+00:00',
}

const history: TaskStatusHistoryItem[] = [
  {
    transition_id: 'eeeeeeee-2222-4222-8222-222222222222',
    task_id: TASK_ID,
    sequence: 1,
    from_status: 'todo',
    to_status: 'in_progress',
    action: 'start',
    reason: null,
    actor_id: USER_ID,
    actor_display_name: 'Fictional user',
    created_at: '2026-08-10T01:00:00+00:00',
  },
]

const update: TaskProgressUpdate = {
  update_id: UPDATE_ID,
  task_id: TASK_ID,
  sequence: 1,
  record_date: '2026-08-10',
  completed_content: 'Fictional completed work',
  progress: 40,
  issues: null,
  next_steps: 'Fictional next step',
  needs_assistance: false,
  is_blocked: false,
  block_transition_id: null,
  created_by: USER_ID,
  created_by_display_name: 'Fictional user',
  created_at: '2026-08-10T02:00:00+00:00',
}

describe('task progress state consistency', () => {
  it('读到旧 task snapshot 时会有界重试，直到目标 update 与最新进展一致', async () => {
    const staleTask: Task = {
      ...task,
      progress: 0,
      last_progress_at: null,
      last_progress_by: null,
      last_progress_by_display_name: null,
    }
    const reader = {
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: history,
      })),
      listUpdates: vi.fn(async () => ({
        ok: true as const,
        data: [update],
      })),
      get: vi
        .fn()
        .mockResolvedValueOnce({ ok: true as const, data: staleTask })
        .mockResolvedValueOnce({ ok: true as const, data: task }),
    }

    const result = await refreshConsistentTaskState(
      reader,
      TASK_ID,
      null,
      UPDATE_ID,
    )

    expect(result).toEqual({
      ok: true,
      data: { task, history, updates: [update] },
    })
    expect(reader.get).toHaveBeenCalledTimes(2)
    expect(reader.listUpdates).toHaveBeenCalledTimes(2)
  })

  it('持续不一致或目标 update 不可见时在固定次数后 fail closed', async () => {
    const reader = {
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: history,
      })),
      listUpdates: vi.fn(async () => ({ ok: true as const, data: [] })),
      get: vi.fn(async () => ({ ok: true as const, data: task })),
    }

    const result = await refreshConsistentTaskState(
      reader,
      TASK_ID,
      null,
      UPDATE_ID,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unknown_service_error' },
    })
    expect(reader.get).toHaveBeenCalledTimes(
      TASK_STATE_CONSISTENCY_MAX_ATTEMPTS,
    )
  })

  it('确认本次 update 已可见后接受另一个合法并发 update 的更新快照', async () => {
    const newerUpdate: TaskProgressUpdate = {
      ...update,
      update_id: 'dddddddd-2222-4222-8222-222222222222',
      sequence: 2,
      progress: 55,
      completed_content: 'Fictional newer work',
      created_at: '2026-08-10T03:00:00+00:00',
    }
    const newerTask: Task = {
      ...task,
      progress: newerUpdate.progress,
      last_progress_at: newerUpdate.created_at,
      updated_at: newerUpdate.created_at,
    }
    const reader = {
      listStatusHistory: vi.fn(async () => ({
        ok: true as const,
        data: history,
      })),
      listUpdates: vi.fn(async () => ({
        ok: true as const,
        data: [update, newerUpdate],
      })),
      get: vi.fn(async () => ({ ok: true as const, data: newerTask })),
    }

    const result = await refreshConsistentTaskState(
      reader,
      TASK_ID,
      null,
      UPDATE_ID,
    )

    expect(result).toEqual({
      ok: true,
      data: { task: newerTask, history, updates: [update, newerUpdate] },
    })
  })

  it('拒绝缺少对应 Task 3.3 block 历史的阻塞进展快照', () => {
    const blockedUpdate: TaskProgressUpdate = {
      ...update,
      is_blocked: true,
      block_transition_id: BLOCK_TRANSITION_ID,
    }

    expect(isTaskProgressConsistent(task, history, [blockedUpdate])).toBe(false)
  })
})
