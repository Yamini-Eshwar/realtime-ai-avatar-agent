'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FormSchema, FormFieldSchema } from '@/lib/form-schema';
import { cn } from '@/lib/shadcn/utils';

interface DynamicFormProps {
  schema: FormSchema;
  formData: Record<string, string>;
  onFormDataChange: (data: Record<string, string>) => void;
  isSubmitted: boolean;
  onSubmit: () => void;
  className?: string;
}

function FormField({
  field,
  value,
  onChange,
}: {
  field: FormFieldSchema;
  value: string;
  onChange: (value: string) => void;
}) {
  const commonProps = {
    id: field.id,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(e.target.value),
    placeholder: field.placeholder,
  };

  switch (field.type) {
    case 'textarea':
      return <Textarea {...commonProps} rows={field.rows ?? 3} />;
    case 'select':
      return (
        <select
          {...commonProps}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <option value="">{field.placeholder ?? 'Select...'}</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    default:
      // text, date, email, tel all render as Input with the appropriate type
      return <Input {...commonProps} type={field.type} />;
  }
}

export function DynamicForm({
  schema,
  formData,
  onFormDataChange,
  isSubmitted,
  onSubmit,
  className,
}: DynamicFormProps) {
  const updateField = (fieldId: string, value: string) => {
    onFormDataChange({ ...formData, [fieldId]: value });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  if (isSubmitted) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-4 py-12', className)}>
        <div className="bg-primary/20 flex size-16 items-center justify-center rounded-full">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <p className="text-lg font-medium">Form submitted</p>
        <p className="text-muted-foreground text-sm">Thank you for completing the form.</p>
      </div>
    );
  }

  return (
    <form
      className={cn('space-y-6 overflow-y-auto p-6 pb-24 md:pb-6', className)}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{schema.title}</h2>
        {schema.description && (
          <p className="text-muted-foreground text-sm">{schema.description}</p>
        )}
      </div>

      {schema.sections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.fields.map((field) => (
              <div key={field.id} className="space-y-2">
                <Label htmlFor={field.id}>
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                <FormField
                  field={field}
                  value={formData[field.id] ?? ''}
                  onChange={(value) => updateField(field.id, value)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Button type="submit" className="w-full" size="lg">
        Submit
      </Button>
    </form>
  );
}
