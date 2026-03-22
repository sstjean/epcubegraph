import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

let msalInstance: PublicClientApplication | null = null;

export async function initializeMsal(): Promise<PublicClientApplication> {
  msalInstance = new PublicClientApplication({
    auth: {
      clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
      redirectUri: `${window.location.origin}/`,
    },
  });
  await msalInstance.handleRedirectPromise();
  return msalInstance;
}

export async function getAccessToken(): Promise<string | null> {
  if (!msalInstance) throw new Error('MSAL not initialized');

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    await msalInstance.loginRedirect({
      scopes: [import.meta.env.VITE_ENTRA_API_SCOPE],
      state: window.location.pathname + window.location.search,
    });
    return null;
  }

  try {
    const response = await msalInstance.acquireTokenSilent({
      scopes: [import.meta.env.VITE_ENTRA_API_SCOPE],
      account: accounts[0],
    });
    return response.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await msalInstance.loginRedirect({
        scopes: [import.meta.env.VITE_ENTRA_API_SCOPE],
        state: window.location.pathname + window.location.search,
      });
      return null;
    }
    throw error;
  }
}

export function isAuthenticated(): boolean {
  if (!msalInstance) return false;
  return msalInstance.getAllAccounts().length > 0;
}

export async function logout(): Promise<void> {
  if (!msalInstance) return;
  await msalInstance.logout();
}
