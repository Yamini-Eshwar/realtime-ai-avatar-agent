'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import type { FormSchema } from '@/lib/form-schema';

function WelcomeImage() {
  return (
    <div className="mb-4 size-64 overflow-hidden rounded-lg border-4 border-gray-200 dark:border-gray-800">
      <Image
        src="/liv.jpg"
        alt="Liv AI assistant"
        width={256}
        height={256}
        priority
        className="size-full object-cover"
      />
    </div>
  );
}

interface FormListItem {
  id: string;
  title: string;
  description?: string;
}

interface WelcomeViewProps {
  startButtonText: string;
  onStartCall: () => void;
  schema: FormSchema | null;
  loadError: string | null;
  onFormSelect: (formId: string) => void;
}

export const WelcomeView = ({
  startButtonText,
  onStartCall,
  schema,
  loadError,
  onFormSelect,
  ref,
}: React.ComponentProps<'div'> & WelcomeViewProps) => {
  const [availableForms, setAvailableForms] = useState<FormListItem[]>([]);

  useEffect(() => {
    fetch('/api/forms')
      .then((res) => res.json())
      .then((data: FormListItem[]) => setAvailableForms(data))
      .catch(() => {});
  }, []);

  return (
    <div ref={ref}>
      <section className="bg-background flex flex-col items-center justify-center text-center">
        <WelcomeImage />

        {/* Form selector */}
        {availableForms.length > 1 && (
          <div className="mt-2 mb-4 w-72">
            <label className="text-muted-foreground mb-1 block text-xs font-medium uppercase tracking-wide">
              Select Form
            </label>
            <select
              value={schema?.id || ''}
              onChange={(e) => onFormSelect(e.target.value)}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-center text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {availableForms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {schema && (
          <p className="text-foreground max-w-prose pt-1 leading-6 font-medium">
            {schema.title}
            <br />
            <span className="text-muted-foreground text-sm font-normal">
              {schema.description || 'Powered by Anam + LiveKit'}
            </span>
          </p>
        )}

        {loadError && (
          <p className="text-destructive max-w-prose pt-1 text-sm">{loadError}</p>
        )}

        {!schema && !loadError && (
          <p className="text-muted-foreground max-w-prose pt-1 text-sm">Loading form...</p>
        )}

        <Button
          size="lg"
          onClick={onStartCall}
          disabled={!schema}
          className="mt-6 w-64 rounded-full font-mono text-xs font-bold tracking-wider uppercase"
        >
          {startButtonText}
        </Button>
      </section>

      <div className="fixed bottom-5 left-0 flex w-full items-center justify-center">
        <p className="text-muted-foreground max-w-prose pt-1 text-xs leading-5 font-normal text-pretty md:text-sm">
          Need help getting set up? Check out the{' '}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://docs.livekit.io/agents/start/voice-ai/"
            className="underline"
          >
            Voice AI quickstart
          </a>
          .
        </p>
      </div>
    </div>
  );
};
