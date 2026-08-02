import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// 使用安装在应用内的 Monaco，避免生产环境依赖外部 CDN。
const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment: GitWebUiMonacoEnvironment;
};

monacoGlobal.MonacoEnvironment = {
  getWorker: (_workerId, label) => {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({
  monaco,
  // 即使某个编辑器版本回退到 AMD loader，也只允许使用应用自身的静态路径。
  paths: { vs: '/assets/monaco' },
});
