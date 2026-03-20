import { render, h } from 'preact';
import { initializeMsal, isAuthenticated, getAccessToken } from './auth';
import { App } from './App';

const authDisabled = import.meta.env.VITE_DISABLE_AUTH === 'true';

async function bootstrap() {
  if (!authDisabled) {
    await initializeMsal();

    if (!isAuthenticated()) {
      await getAccessToken();
      return;
    }
  }

  const root = document.getElementById('app');
  if (root) {
    render(<App />, root);
  }
}

bootstrap();
