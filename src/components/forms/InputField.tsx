import { useId, type InputHTMLAttributes } from 'react'
type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  description?: string
  error?: string
}
export function InputField({
  description,
  error,
  id: suppliedId,
  label,
  required,
  ...props
}: Props) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const describedBy =
    [description && descriptionId, error && errorId]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-label="必填"> *</span>}
      </label>
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || undefined}
        id={id}
        required={required}
      />
      {description && <small id={descriptionId}>{description}</small>}
      {error && (
        <small className="field-error" id={errorId}>
          {error}
        </small>
      )}
    </div>
  )
}
