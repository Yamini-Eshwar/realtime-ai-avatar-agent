import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const FORMS_DIR = path.join(process.cwd(), 'public', 'forms');

// GET /api/forms — list all available form schemas
export async function GET() {
  try {
    const files = await fs.readdir(FORMS_DIR);
    const forms = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(FORMS_DIR, file), 'utf-8');
      const schema = JSON.parse(content);
      forms.push({
        id: schema.id,
        title: schema.title,
        description: schema.description,
      });
    }

    return NextResponse.json(forms);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

// POST /api/forms — create a new form schema
// Body: full form JSON with id, title, sections, etc.
export async function POST(req: Request) {
  try {
    const schema = await req.json();

    // Validate required fields
    if (!schema.id || !schema.title || !schema.sections) {
      return NextResponse.json(
        { error: 'Missing required fields: id, title, sections' },
        { status: 400 }
      );
    }

    // Sanitize ID
    if (!/^[a-zA-Z0-9_-]+$/.test(schema.id)) {
      return NextResponse.json(
        { error: 'Invalid form ID. Use only letters, numbers, hyphens, underscores.' },
        { status: 400 }
      );
    }

    const filePath = path.join(FORMS_DIR, `${schema.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(schema, null, 2), 'utf-8');

    return NextResponse.json(
      { success: true, message: `Form "${schema.id}" created`, id: schema.id },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
