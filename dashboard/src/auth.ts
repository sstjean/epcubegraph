import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

let msalInstance: PublicClientApplication | null = null;
let accessTokenRequestInFlight: Promise<string | null> | null = null;
let loginRedirectInFlight = false;

function currentRouteState(): string {
  return window.location.pathname + window.location.search;
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const maybeCode = (error as { errorCode?: unknown }).errorCode;
  return typeof maybeCode === 'string' ? maybeCode : null;
}

function isMonitorWindowTimeout(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === 'monitor_window_timeout') return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes('monitor_window_timeout');
}

async function triggerLoginRedirect(): Promise<null> {
  if (loginRedirectInFlight) return null;

  loginRedirectInFlight = true;
  await msalInstance!.loginRedirect({
    scopes: [import.meta.env.VITE_ENTRA_API_SCOPE],
    state: currentRouteState(),
  });
  return null;
}

export async function initializeMsal(): Promise<PublicClientApplication> {
  msalInstance = new PublicClientApplication({
    auth: {
      clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
      redirectUri: `${window.location.origin}/`,
    },
  });
  await msalInstance.initialize();
  const result = await msalInstance.handleRedirectPromise();
  loginRedirectInFlight = false;
  if (result?.state) {
    history.replaceState(null, '', result.state);
  }
  return msalInstance;
}

export async function getAccessToken(): Promise<string | null> {
  if (!msalInstance) throw new Error('MSAL not initialized');

  if (!accessTokenRequestInFlight) {
    accessTokenRequestInFlight = (async () => {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length === 0) {
        return triggerLoginRedirect();
      }

      try {
        const response = await msalInstance.acquireTokenSilent({
          scopes: [import.meta.env.VITE_ENTRA_API_SCOPE],
          account: accounts[0],
        });
        return response.accessToken;
      } catch (error) {
        const errorCode = getErrorCode(error);
        if (errorCode === 'interaction_in_progress') {
          return null;
        }
        if (error instanceof InteractionRequiredAuthError || isMonitorWindowTimeout(error)) {
          return triggerLoginRedirect();
        }
        throw error;
      }
    })().finally(() => {
      accessTokenRequestInFlight = null;
    });
  }

  return accessTokenRequestInFlight;
}

export function isAuthenticated(): boolean {
  if (!msalInstance) return false;
  return msalInstance.getAllAccounts().length > 0;
}

