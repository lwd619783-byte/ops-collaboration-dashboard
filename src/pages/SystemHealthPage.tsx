import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DateDisplay } from '@/components/ui/DateDisplay'
import {
  getSupabaseClient,
  type SupabaseClientResolution,
} from '@/lib/supabase/client'
import {
  getSupabaseConfig,
  type SupabaseConfigResult,
} from '@/lib/supabase/config'
import {
  checkDatabaseHealth,
  type DatabaseHealthResult,
} from '@/lib/supabase/health'
import type { Database } from '@/types/database.generated'

type HealthPageState =
  | { status: 'checking' }
  | { status: 'ok'; checkedAt: string }
  | { status: 'error'; message: string }

type SystemHealthPageProps = {
  resolveConfig?: () => SupabaseConfigResult
  resolveClient?: (result: SupabaseConfigResult) => SupabaseClientResolution
  runHealthCheck?: (
    client: SupabaseClient<Database>,
    signal: AbortSignal,
  ) => Promise<DatabaseHealthResult>
}

const genericConnectionError =
  '暂时无法连接数据库，请稍后重试或联系系统维护人员。'

function FailureState({
  message,
  retry,
}: {
  message: string
  retry: ComponentProps<typeof Button>['onClick']
}) {
  return (
    <ErrorState
      title="数据库连接失败"
      description={message}
      action={
        <Button onClick={retry} variant="secondary">
          重新检查
        </Button>
      }
    />
  )
}

export function SystemHealthPage({
  resolveConfig = getSupabaseConfig,
  resolveClient = getSupabaseClient,
  runHealthCheck = checkDatabaseHealth,
}: SystemHealthPageProps) {
  const configResult = useMemo(() => resolveConfig(), [resolveConfig])
  const clientResult = useMemo(
    () =>
      configResult.status === 'configured'
        ? resolveClient(configResult)
        : undefined,
    [configResult, resolveClient],
  )
  const [attempt, setAttempt] = useState(0)
  const [healthState, setHealthState] = useState<HealthPageState>({
    status: 'checking',
  })

  useEffect(() => {
    if (!clientResult || clientResult.status !== 'ready') return

    const controller = new AbortController()
    let active = true

    void runHealthCheck(clientResult.client, controller.signal)
      .then((result) => {
        if (!active) return
        setHealthState(
          result.status === 'ok'
            ? { status: 'ok', checkedAt: result.checkedAt }
            : { status: 'error', message: result.message },
        )
      })
      .catch(() => {
        if (active) {
          setHealthState({ status: 'error', message: genericConnectionError })
        }
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, clientResult, runHealthCheck])

  if (configResult.status === 'unconfigured') {
    return (
      <EmptyState
        title="Supabase 尚未配置"
        description="请在本地环境中配置 Supabase URL 和 publishable key 后重新打开此页面。"
      />
    )
  }

  if (configResult.status === 'invalid') {
    return (
      <ErrorState
        title="Supabase 配置无效"
        description={configResult.message}
      />
    )
  }

  if (!clientResult || clientResult.status !== 'ready') {
    return (
      <FailureState
        message={genericConnectionError}
        retry={() => {
          setHealthState({ status: 'checking' })
          setAttempt((current) => current + 1)
        }}
      />
    )
  }

  if (healthState.status === 'checking') {
    return (
      <section className="health-card" aria-label="数据库连接状态">
        <LoadingState title="正在检查数据库连接" />
      </section>
    )
  }

  if (healthState.status === 'error') {
    return (
      <FailureState
        message={healthState.message}
        retry={() => {
          setHealthState({ status: 'checking' })
          setAttempt((current) => current + 1)
        }}
      />
    )
  }

  return (
    <section className="health-card" aria-live="polite">
      <div className="health-heading">
        <div>
          <p className="eyebrow">连接状态</p>
          <h2>数据库连接正常</h2>
        </div>
        <Badge className="badge-success">正常</Badge>
      </div>
      <dl className="health-details">
        <div>
          <dt>数据库检查时间</dt>
          <dd>
            <DateDisplay kind="date-time" value={healthState.checkedAt} />
          </dd>
        </div>
      </dl>
    </section>
  )
}
