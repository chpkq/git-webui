import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WorkspaceView = 'history' | 'working';

interface WorkspaceState {
  repositoryId: string | null;
  ref: string;
  commitHash: string | null;
  view: WorkspaceView;
  setRepositoryId: (repositoryId: string | null) => void;
  setRef: (ref: string) => void;
  setCommitHash: (commitHash: string | null) => void;
  setView: (view: WorkspaceView) => void;
}

const getUrlState = (): Pick<WorkspaceState, 'repositoryId' | 'ref' | 'commitHash'> => {
  if (typeof window === 'undefined') return { repositoryId: null, ref: 'HEAD', commitHash: null };
  const search = new URLSearchParams(window.location.search);
  return {
    repositoryId: search.get('repo'),
    ref: search.get('ref') ?? 'HEAD',
    commitHash: search.get('commit'),
  };
};

const urlState = getUrlState();

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      ...urlState,
      view: 'history',
      setRepositoryId: (repositoryId) => set({ repositoryId, commitHash: null }),
      setRef: (ref) => set({ ref, commitHash: null }),
      setCommitHash: (commitHash) => set({ commitHash }),
      setView: (view) => set({ view }),
    }),
    {
      name: 'git-webui-workspace',
      partialize: (state) => ({
        repositoryId: state.repositoryId,
        ref: state.ref,
        commitHash: state.commitHash,
        view: state.view,
      }),
    },
  ),
);
