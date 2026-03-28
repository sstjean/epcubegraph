/// <reference types="vite/client" />

// Allow preact-router's `path` prop on any component used as a route
declare namespace preact {
  namespace JSX {
    interface IntrinsicAttributes {
      path?: string;
    }
  }
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_ENTRA_CLIENT_ID: string;
  readonly VITE_ENTRA_TENANT_ID: string;
  readonly VITE_ENTRA_API_SCOPE: string;
  readonly VITE_DISABLE_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
