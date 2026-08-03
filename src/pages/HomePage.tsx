import { useState } from 'react'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Table } from '@/components/ui/Table'

export function HomePage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  return (
    <section className="page-stack">
      <div className="intro">
        <div>
          <p className="eyebrow">应用基础</p>
          <h2>协作界面已准备就绪</h2>
          <p>统一的导航、反馈与展示组件已建立，后续业务页面将复用此基础。</p>
        </div>
        <Badge className="badge-success">界面基线已就绪</Badge>
      </div>
      <div className="card-grid">
        <article className="card">
          <h3>项目协作</h3>
          <p>后续接入项目页面与权限边界。</p>
        </article>
        <article className="card">
          <h3>任务跟踪</h3>
          <p>后续接入任务状态和协作流程。</p>
        </article>
        <article className="card">
          <h3>团队负荷</h3>
          <p>后续接入可审计的汇总展示。</p>
        </article>
      </div>
      <div className="card">
        <h3>组件确认</h3>
        <p>此操作仅用于验证确认对话框，不会创建或修改任何业务数据。</p>
        <Button onClick={() => setDialogOpen(true)}>打开示例确认框</Button>
        {confirmed && (
          <p className="confirmation" role="status">
            示例操作已确认。
          </p>
        )}
      </div>
      <Table
        caption="工作台数据预览"
        emptyMessage="暂无项目数据，等待后续接入。"
      />
      <EmptyState
        title="暂无待处理内容"
        description="业务数据将在后续独立任务中接入。"
      />
      <Dialog
        description="这是一个非业务示例，不会写入任何数据。"
        onClose={() => setDialogOpen(false)}
        onConfirm={() => {
          setConfirmed(true)
          setDialogOpen(false)
        }}
        open={dialogOpen}
        title="确认示例操作"
      />
    </section>
  )
}
