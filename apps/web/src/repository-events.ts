import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export const useRepositoryEvents = (repositoryId: string | null): void => {
  const queryClient = useQueryClient();
  const seenEvents = useRef(new Set<string>());

  useEffect(() => {
    if (repositoryId === null) return;
    const source = new EventSource('/api/operations/events');
    const rememberEvent = (event: Event): boolean => {
      const message = event as MessageEvent<string>;
      const key = `${event.type}:${message.lastEventId}:${message.data}`;
      if (seenEvents.current.has(key)) return false;
      seenEvents.current.add(key);
      if (seenEvents.current.size > 500) {
        const oldest = seenEvents.current.values().next().value as string | undefined;
        if (oldest !== undefined) seenEvents.current.delete(oldest);
      }
      return true;
    };
    const refreshRepository = (event: Event): void => {
      if (!rememberEvent(event)) return;
      void queryClient.invalidateQueries({ queryKey: ['status', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['locations', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['commits', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['commit-detail', repositoryId] });
    };
    const refreshOperation = (event: Event): void => {
      if (!rememberEvent(event)) return;
      void queryClient.invalidateQueries({ queryKey: ['status', repositoryId] });
    };
    source.addEventListener('operation.updated', refreshOperation);
    source.addEventListener('repo.changed', refreshRepository);
    return () => {
      source.close();
    };
  }, [queryClient, repositoryId]);
};
