import { useId, type SelectHTMLAttributes } from 'react'
type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  description?: string
  error?: string
}
export function SelectField({
  children,
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
    <label className="field" htmlFor={id}>
      <span>
        {label}
        {required && <span aria-label="必填"> *</span>}
      </span>
      <select
        {...props}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || undefined}
        id={id}
        required={required}
      >
        {children}
      </select>
      {description && <small id={descriptionId}>{description}</small>}
      {error && (
        <small className="field-error" id={errorId}>
          {error}
        </small>
      )}
    </label>
  )
}
