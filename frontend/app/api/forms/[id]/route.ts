import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// GET /api/forms/{id}
// Loads form schema from public/forms/{id}.json
// In production, replace this with a DB lookup.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sanitize: only allow alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid form ID' }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'public', 'forms', `${id}.json`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const schema = JSON.parse(content);
    return NextResponse.json(schema);
  } catch {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 });
  }
}
