import { forwardRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FormFieldProps {
  label?: string
  error?: string
  helperText?: string
  children: ReactNode
  className?: string
  /** id of the control this label describes, so clicking the label focuses it. */
  htmlFor?: string
}

export function FormField({ label, error, helperText, children, className, htmlFor }: FormFieldProps) {
  return (
    <div className={className}>
      {label && <Label htmlFor={htmlFor} className="mb-2">{label}</Label>}
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {helperText && !error && <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
    </div>
  )
}

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, helperText, className, id, type, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
    const isPassword = type === 'password'
    const [showPassword, setShowPassword] = useState(false)
    return (
      <FormField label={label} error={error} helperText={helperText} htmlFor={inputId}>
        <div className="relative">
          <Input
            ref={ref}
            id={inputId}
            type={isPassword && showPassword ? 'text' : type}
            className={cn('min-h-[44px]', isPassword && 'pr-10', error && 'border-destructive', className)}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>
      </FormField>
    )
  },
)
FormInput.displayName = 'FormInput'

interface FormTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  helperText?: string
}

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
    return (
      <FormField label={label} error={error} helperText={helperText} htmlFor={inputId}>
        <Textarea
          ref={ref}
          id={inputId}
          className={cn('min-h-[44px]', error && 'border-destructive', className)}
          {...props}
        />
      </FormField>
    )
  },
)
FormTextarea.displayName = 'FormTextarea'
