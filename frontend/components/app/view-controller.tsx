'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSessionContext } from '@livekit/components-react';
import type { AppConfig } from '@/app-config';
import { SessionView } from '@/components/app/session-view';
import { WelcomeView } from '@/components/app/welcome-view';
import type { FormSchema } from '@/lib/form-schema';
import { buildEmptyFormData } from '@/lib/form-schema';

const MotionWelcomeView = motion.create(WelcomeView);
const MotionSessionView = motion.create(SessionView);

const VIEW_MOTION_PROPS = {
  variants: {
    visible: {
      opacity: 1,
    },
    hidden: {
      opacity: 0,
    },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
  transition: {
    duration: 0.5,
    ease: 'linear',
  },
};

const DEFAULT_FORM_ID = 'visitor-intake';

interface ViewControllerProps {
  appConfig: AppConfig;
  onFormIdChange: (formId: string) => void;
}

export function ViewController({ appConfig, onFormIdChange }: ViewControllerProps) {
  const { isConnected, start } = useSessionContext();
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pre-load schema on mount (before session starts)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const formId = params.get('form') || DEFAULT_FORM_ID;
    loadForm(formId);
  }, []);

  const loadForm = (formId: string) => {
    setLoadError(null);
    onFormIdChange(formId); // Notify App so the token source includes the form ID
    fetch(`/api/forms/${formId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Form "${formId}" not found`);
        return res.json();
      })
      .then((data: FormSchema) => {
        setSchema(data);
        setFormData(buildEmptyFormData(data));
      })
      .catch((err) => setLoadError(err.message));
  };

  return (
    <AnimatePresence mode="wait">
      {/* Welcome view */}
      {!isConnected && (
        <MotionWelcomeView
          key="welcome"
          {...VIEW_MOTION_PROPS}
          startButtonText={appConfig.startButtonText}
          onStartCall={start}
          schema={schema}
          loadError={loadError}
          onFormSelect={loadForm}
        />
      )}
      {/* Session view */}
      {isConnected && (
        <MotionSessionView
          key="session-view"
          {...VIEW_MOTION_PROPS}
          appConfig={appConfig}
          schema={schema}
          formData={formData}
          setFormData={setFormData}
        />
      )}
    </AnimatePresence>
  );
}
