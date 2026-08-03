import type { HTMLAttributes } from 'react'
import { classNames } from '@/lib/classNames'
export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={classNames('badge', className)} />
}
