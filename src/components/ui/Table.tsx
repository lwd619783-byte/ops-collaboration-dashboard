import type { ReactNode } from 'react'
export function Table({
  caption,
  children,
  emptyMessage,
}: {
  caption: string
  children?: ReactNode
  emptyMessage?: string
}) {
  return (
    <div className="table-wrap">
      <table>
        <caption>{caption}</caption>
        {children ?? (
          <tbody>
            <tr>
              <td className="table-empty">{emptyMessage ?? '暂无数据'}</td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  )
}
