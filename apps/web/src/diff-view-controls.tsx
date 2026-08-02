import type * as Monaco from 'monaco-editor';

const DIFF_CONTEXT_LINE_COUNT = 3;

export const createDiffEditorOptions = ({
  renderSideBySide,
  showFullFile,
}: {
  renderSideBySide: boolean;
  showFullFile: boolean;
}): Monaco.editor.IDiffEditorOptions => ({
  readOnly: true,
  renderSideBySide,
  minimap: { enabled: false },
  wordWrap: 'on',
  hideUnchangedRegions: {
    enabled: !showFullFile,
    contextLineCount: DIFF_CONTEXT_LINE_COUNT,
    minimumLineCount: DIFF_CONTEXT_LINE_COUNT,
    revealLineCount: 20,
  },
});

export const DiffVisibilityToggle = ({
  showFullFile,
  onToggle,
}: {
  showFullFile: boolean;
  onToggle: () => void;
}) => (
  <button
    className="small-action-button diff-visibility-toggle"
    type="button"
    aria-pressed={showFullFile}
    aria-label={showFullFile ? '切换为显示 Diff 附近行' : '切换为显示完整文件'}
    onClick={onToggle}
  >
    {showFullFile ? '显示 Diff 附近行' : '显示完整文件'}
  </button>
);
