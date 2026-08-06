import { useCallback, useEffect, useRef, useState } from 'react'
import { InputField } from '@/components/forms/InputField'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useProjects } from '@/features/projects/ProjectContext'
import type { Project, ProjectModule } from '@/features/projects/types'
import {
  normalizeProjectModuleName,
  PROJECT_MODULE_LIMITS,
  validateProjectModuleName,
} from '@/features/projects/validation'

type ProjectModulesSectionProps = {
  project: Project
  canManage: boolean
}

type ModuleDialog =
  | { kind: 'add' }
  | { kind: 'rename'; module: ProjectModule }
  | { kind: 'delete'; module: ProjectModule }
  | null

function isUnauthorized(code: string): boolean {
  return (
    code === 'permission_denied' ||
    code === 'not_found_or_forbidden' ||
    code === 'module_not_found_or_forbidden' ||
    code === 'authentication_required'
  )
}

export function ProjectModulesSection({
  canManage,
  project,
}: ProjectModulesSectionProps) {
  const projects = useProjects()
  const [modules, setModules] = useState<ProjectModule[]>([])
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'error' | 'unauthorized'
  >('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ModuleDialog>(null)
  const [moduleName, setModuleName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isMutating, setMutating] = useState(false)
  const mountedRef = useRef(true)
  const requestEpochRef = useRef(0)
  const actionEpochRef = useRef(0)
  const mutationInFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestEpochRef.current += 1
      actionEpochRef.current += 1
      mutationInFlightRef.current = false
    }
  }, [])

  const loadModules = useCallback(async () => {
    const epoch = ++requestEpochRef.current
    const requestedProjectId = project.project_id
    setLoadState('loading')
    setLoadError(null)
    const result = await projects.listModules(requestedProjectId)
    if (!mountedRef.current || requestEpochRef.current !== epoch) return
    if (!result.ok) {
      setModules([])
      setLoadError(result.error.message)
      setLoadState(isUnauthorized(result.error.code) ? 'unauthorized' : 'error')
      return
    }
    setModules(result.data)
    setLoadState('ready')
  }, [project.project_id, projects])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadModules()
    })
    return () => {
      cancelled = true
      requestEpochRef.current += 1
    }
  }, [loadModules])

  type ProjectContextMutation = () => ReturnType<typeof projects.addModule>

  const runMutation = async (
    successMessage: string,
    operation: ProjectContextMutation,
  ): Promise<boolean> => {
    if (mutationInFlightRef.current) return false
    mutationInFlightRef.current = true
    const epoch = ++actionEpochRef.current
    const requestedProjectId = project.project_id
    setMutating(true)
    setMutationError(null)
    setFeedback(null)
    const result = await operation()
    if (!mountedRef.current || actionEpochRef.current !== epoch) return false
    mutationInFlightRef.current = false
    setMutating(false)
    if (!result.ok) {
      setMutationError(result.error.message)
      return false
    }
    if (
      result.data.some((module) => module.project_id !== requestedProjectId)
    ) {
      setMutationError('模块操作暂时无法完成，请稍后重试。')
      return false
    }
    setModules(result.data)
    setFeedback(successMessage)
    return true
  }

  const openAdd = () => {
    setDialog({ kind: 'add' })
    setModuleName('')
    setNameError(null)
    setMutationError(null)
  }

  const openRename = (module: ProjectModule) => {
    setDialog({ kind: 'rename', module })
    setModuleName(module.name)
    setNameError(null)
    setMutationError(null)
  }

  const submitName = async () => {
    if (!dialog || dialog.kind === 'delete' || isMutating) return
    const validationError = validateProjectModuleName(moduleName)
    if (validationError) {
      setNameError(validationError)
      return
    }
    const normalizedName = normalizeProjectModuleName(moduleName)
    const succeeded =
      dialog.kind === 'add'
        ? await runMutation('模块已新增。', () =>
            projects.addModule({
              projectId: project.project_id,
              name: normalizedName,
            }),
          )
        : await runMutation('模块名称已更新。', () =>
            projects.renameModule({
              projectId: project.project_id,
              moduleId: dialog.module.module_id,
              name: normalizedName,
            }),
          )
    if (succeeded) setDialog(null)
  }

  const move = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (isMutating || targetIndex < 0 || targetIndex >= modules.length) {
      return
    }
    const reordered = modules.map((module) => module.module_id)
    ;[reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ]
    await runMutation('模块顺序已更新。', () =>
      projects.reorderModules({
        projectId: project.project_id,
        moduleIds: reordered,
      }),
    )
  }

  const remove = async () => {
    if (!dialog || dialog.kind !== 'delete' || isMutating) return
    const succeeded = await runMutation('模块已删除，剩余顺序已更新。', () =>
      projects.deleteModule({
        projectId: project.project_id,
        moduleId: dialog.module.module_id,
      }),
    )
    if (succeeded) setDialog(null)
  }

  const closeDialog = () => {
    if (isMutating) return
    setDialog(null)
    setNameError(null)
    setMutationError(null)
  }

  const archived = project.status === 'archived'
  const showManagement = canManage && !archived

  return (
    <section
      className="project-modules-section"
      aria-labelledby="project-modules-title"
    >
      <div className="project-modules-heading">
        <div>
          <h3 id="project-modules-title">工作模块</h3>
          <p>
            {loadState === 'ready'
              ? `共 ${modules.length} 个模块`
              : '按项目顺序组织工作'}
          </p>
        </div>
        {showManagement && loadState === 'ready' && (
          <Button disabled={isMutating} onClick={openAdd}>
            新增模块
          </Button>
        )}
      </div>

      {archived && (
        <p className="project-modules-readonly">
          项目已归档，模块保留为只读状态，不能新增、改名、排序或删除。
        </p>
      )}
      {!archived && !showManagement && loadState === 'ready' && (
        <p className="project-modules-readonly">
          你可以查看模块；只有项目 owner、lead
          或现有项目管理规则授权的工作空间管理员可以修改。
        </p>
      )}

      {feedback && (
        <p aria-live="polite" className="confirmation" role="status">
          {feedback}
        </p>
      )}
      {mutationError && dialog === null && (
        <p className="form-error" role="alert">
          {mutationError}
        </p>
      )}

      {loadState === 'loading' && (
        <p aria-live="polite" className="project-modules-state">
          正在加载工作模块…
        </p>
      )}
      {loadState === 'unauthorized' && (
        <div className="project-modules-state">
          <p>{loadError ?? '你暂时无法读取该项目的模块。'}</p>
        </div>
      )}
      {loadState === 'error' && (
        <div className="project-modules-state">
          <p>{loadError ?? '工作模块暂时无法加载。'}</p>
          <Button onClick={() => void loadModules()} variant="secondary">
            重试加载模块
          </Button>
        </div>
      )}
      {loadState === 'ready' && modules.length === 0 && (
        <p className="project-modules-empty">暂未创建工作模块。</p>
      )}
      {loadState === 'ready' && modules.length > 0 && (
        <ol className="project-module-list">
          {modules.map((module, index) => (
            <li className="project-module-row" key={module.module_id}>
              <div className="project-module-name">
                <span aria-hidden="true" className="project-module-position">
                  {index + 1}
                </span>
                <span>{module.name}</span>
              </div>
              {showManagement && (
                <div className="project-module-actions">
                  <Button
                    aria-label={`上移模块：${module.name}`}
                    disabled={isMutating || index === 0}
                    onClick={() => void move(index, -1)}
                    size="sm"
                    variant="secondary"
                  >
                    上移
                  </Button>
                  <Button
                    aria-label={`下移模块：${module.name}`}
                    disabled={isMutating || index === modules.length - 1}
                    onClick={() => void move(index, 1)}
                    size="sm"
                    variant="secondary"
                  >
                    下移
                  </Button>
                  <Button
                    aria-label={`改名模块：${module.name}`}
                    disabled={isMutating}
                    onClick={() => openRename(module)}
                    size="sm"
                    variant="secondary"
                  >
                    改名
                  </Button>
                  <Button
                    aria-label={`删除模块：${module.name}`}
                    disabled={isMutating}
                    onClick={() => {
                      setDialog({ kind: 'delete', module })
                      setMutationError(null)
                    }}
                    size="sm"
                    variant="danger"
                  >
                    删除
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <Dialog
        confirmDisabled={isMutating}
        confirmLabel={
          isMutating
            ? '正在保存'
            : dialog?.kind === 'add'
              ? '确认新增'
              : '确认改名'
        }
        confirmLoading={isMutating}
        description="模块名称会去除首尾空白并合并连续空白；同一项目内不能使用重复名称。"
        onClose={closeDialog}
        onConfirm={() => void submitName()}
        open={dialog?.kind === 'add' || dialog?.kind === 'rename'}
        title={dialog?.kind === 'add' ? '新增工作模块' : '修改模块名称'}
      >
        <div className="dialog-form">
          <InputField
            autoComplete="off"
            disabled={isMutating}
            error={nameError ?? undefined}
            label="模块名称"
            maxLength={PROJECT_MODULE_LIMITS.name}
            onChange={(event) => {
              setModuleName(event.target.value)
              setNameError(null)
              setMutationError(null)
            }}
            required
            value={moduleName}
          />
          {mutationError &&
            (dialog?.kind === 'add' || dialog?.kind === 'rename') && (
              <p className="form-error" role="alert">
                {mutationError}
              </p>
            )}
        </div>
      </Dialog>

      <Dialog
        confirmDisabled={isMutating}
        confirmLabel={isMutating ? '正在删除' : '确认删除'}
        confirmLoading={isMutating}
        danger
        description="删除后该模块不会再显示，剩余模块会自动重新编号。此操作不能在当前版本中撤销。"
        onClose={closeDialog}
        onConfirm={() => void remove()}
        open={dialog?.kind === 'delete'}
        title="删除工作模块"
      >
        {dialog?.kind === 'delete' && (
          <>
            <p>待删除模块：{dialog.module.name}</p>
            {mutationError && (
              <p className="form-error" role="alert">
                {mutationError}
              </p>
            )}
          </>
        )}
      </Dialog>
    </section>
  )
}
