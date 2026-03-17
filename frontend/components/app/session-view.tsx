'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAgent, useSessionContext } from '@livekit/components-react';
import type { AppConfig } from '@/app-config';
import { AvatarPanel } from '@/components/app/avatar-panel';
import { DynamicForm } from '@/components/app/dynamic-form';
import { useRpcHandlers } from '@/hooks/useRpcHandlers';
import type { FormSchema } from '@/lib/form-schema';

interface SessionViewProps {
  appConfig: AppConfig;
  schema: FormSchema | null;
  formData: Record<string, string>;
  setFormData: (data: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
}

const POST_SUBMIT_FALLBACK_MS = 90_000;

export const SessionView = ({
  appConfig,
  schema,
  formData,
  setFormData,
  ...props
}: React.ComponentProps<'section'> & SessionViewProps) => {
  void appConfig; // passed for type/API consistency; may be used later
  const { end, room, isConnected } = useSessionContext();
  const agent = useAgent();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const hasSpokenRef = useRef(false);

  useEffect(() => {
    if (!isSubmitted) return;

    const fallbackTimer = setTimeout(() => {
      end();
    }, POST_SUBMIT_FALLBACK_MS);

    return () => clearTimeout(fallbackTimer);
  }, [isSubmitted, end]);

  useEffect(() => {
    if (!isSubmitted) return;

    if (agent.isFinished) {
      // Give a brief moment before disconnecting so the transition feels smooth
      const t = setTimeout(() => end(), 2000);
      return () => clearTimeout(t);
    }

    if (agent.state === 'speaking') {
      hasSpokenRef.current = true;
    }

    // Wait 2s after agent finishes speaking for a smooth close
    if (hasSpokenRef.current && agent.state !== 'speaking') {
      const t = setTimeout(() => end(), 2000);
      return () => clearTimeout(t);
    }
  }, [isSubmitted, agent.state, agent.isFinished, end]);

  useRpcHandlers({
    room,
    isConnected,
    formData,
    setFormData,
    setIsSubmitted,
    schema,
  });

  return (
    <section
      className="bg-background relative flex h-full w-full flex-col overflow-hidden"
      style={{ zIndex: 'var(--app-z-session)' }}
      {...props}
    >
      {/* Main content: avatar left, form right */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex max-h-[45%] w-full min-w-0 shrink-0 flex-col border-b md:max-h-none md:w-[46%] md:border-b-0">
          <AvatarPanel className="flex-1" />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {schema ? (
            <DynamicForm
              schema={schema}
              formData={formData}
              onFormDataChange={setFormData}
              isSubmitted={isSubmitted}
              onSubmit={() => setIsSubmitted(true)}
              className="flex-1"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-muted-foreground text-sm">No form loaded.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
