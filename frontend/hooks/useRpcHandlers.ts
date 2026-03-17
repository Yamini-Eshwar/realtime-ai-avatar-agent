'use client';

import { useEffect, useRef } from 'react';
import { RpcError, type RpcInvocationData } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { FormSchema } from '@/lib/form-schema';

interface UseRpcHandlersOptions {
  room: Room | undefined;
  isConnected: boolean;
  formData: Record<string, string>;
  setFormData: (data: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setIsSubmitted: (submitted: boolean) => void;
  schema: FormSchema | null;
}

/** For select fields, match the agent's value to the closest option (case-insensitive). */
function normalizeSelectValue(schema: FormSchema | null, fieldName: string, value: string): string {
  if (!schema) return value;
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.id === fieldName && field.type === 'select' && field.options) {
        const match = field.options.find(
          (opt) => opt.toLowerCase() === value.toLowerCase()
        );
        if (match) return match;
      }
    }
  }
  return value;
}

export function useRpcHandlers({
  room,
  isConnected,
  formData,
  setFormData,
  setIsSubmitted,
  schema,
}: UseRpcHandlersOptions) {
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  useEffect(() => {
    if (!room || !isConnected) {
      return;
    }

    room.registerRpcMethod('updateField', async (data: RpcInvocationData) => {
      try {
        const { fieldName, value } = JSON.parse(data.payload) as {
          fieldName: string;
          value: string;
        };
        const normalized = normalizeSelectValue(schemaRef.current, fieldName, value);
        setFormData((prev) => ({ ...prev, [fieldName]: normalized }));
        return JSON.stringify({ success: true, fieldName, value: normalized });
      } catch (error) {
        if (error instanceof RpcError) throw error;
        throw new RpcError(1500, 'Failed to update field');
      }
    });

    room.registerRpcMethod('getFormState', async () => {
      return JSON.stringify(formDataRef.current);
    });

    room.registerRpcMethod('submitForm', async () => {
      setIsSubmitted(true);
      return JSON.stringify({ success: true });
    });

    return () => {
      room.unregisterRpcMethod('updateField');
      room.unregisterRpcMethod('getFormState');
      room.unregisterRpcMethod('submitForm');
    };
  }, [room, isConnected, setFormData, setIsSubmitted]);
}
