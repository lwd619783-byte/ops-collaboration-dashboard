import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { classNames } from '@/lib/classNames'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'md' | 'sm'
  loading?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}
export function Button({
  children,
  className,
  disabled,
  leading,
  loading = false,
  size = 'md',
  trailing,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classNames(
        'button',
        `button-${variant}`,
        `button-${size}`,
        className,
      )}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? (
        <span aria-hidden="true" className="button-spinner" />
      ) : (
        leading
      )}
      {children}
      {trailing}
      <span className="sr-only">{loading ? '正在处理' : ''}</span>
    </button>
  )
}
