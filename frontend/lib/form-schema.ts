// ── Dynamic form schema types ──
// A form is defined by a JSON schema. The kiosk loads it via GET /api/forms/{id}
// and both the frontend renderer and the backend agent use the same schema.

export interface FormFieldSchema {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'email' | 'tel';
  placeholder?: string;
  required?: boolean;
  rows?: number; // for textarea
  options?: string[]; // for select
}

export interface FormSectionSchema {
  title: string;
  fields: FormFieldSchema[];
}

export interface FormSchema {
  id: string;
  title: string;
  description?: string;
  sections: FormSectionSchema[];
}

/** Extract all field IDs from a schema */
export function getFieldIds(schema: FormSchema): string[] {
  return schema.sections.flatMap((s) => s.fields.map((f) => f.id));
}

/** Build an empty form data object from schema (all values default to '') */
export function buildEmptyFormData(schema: FormSchema): Record<string, string> {
  const data: Record<string, string> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      data[field.id] = '';
    }
  }
  return data;
}

/** Check if a field name is valid for the given schema */
export function isValidField(schema: FormSchema, fieldName: string): boolean {
  return getFieldIds(schema).includes(fieldName);
}
