import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

type DialogProps = {
  open: boolean
  onClose: () => void
  onConfirm?: () => void
  title: string
  description: string
  confirmLabel?: string
  confirmDisabled?: boolean
  confirmLoading?: boolean
  danger?: boolean
  children?: ReactNode
}
export function Dialog({
  children,
  confirmLabel = '确认',
  confirmDisabled = false,
  confirmLoading = false,
  danger = false,
  description,
  onClose,
  onConfirm,
  open,
  title,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      dialog.showModal()
    }
    if (!open && dialog.open) {
      dialog.close()
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [open])
  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="dialog"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      ref={dialogRef}
    >
      <div className="dialog-content">
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <Button
            aria-label="关闭对话框"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            关闭
          </Button>
        </div>
        <p id={descriptionId}>{description}</p>
        {children}
        <div className="dialog-actions">
          <Button
            disabled={confirmLoading}
            onClick={onClose}
            variant="secondary"
          >
            取消
          </Button>
          {onConfirm && (
            <Button
              disabled={confirmDisabled}
              loading={confirmLoading}
              onClick={onConfirm}
              variant={danger ? 'danger' : 'primary'}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  )
}
