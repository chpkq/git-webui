/// <reference types="vite/client" />

declare module '*?worker' {
  const worker: new () => Worker;
  export default worker;
}

declare global {
  interface GitWebUiMonacoEnvironment {
    getWorker: (workerId: string, label: string) => Worker;
  }

  var MonacoEnvironment: GitWebUiMonacoEnvironment;
}

export {};
