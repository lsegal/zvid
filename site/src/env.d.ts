/// <reference types="vite/client" />

interface ImportMetaEnv {
  // The deployed app, where "Launch zvid" links go. Set in site/.env.
  readonly VITE_APP_URL: string;
}
