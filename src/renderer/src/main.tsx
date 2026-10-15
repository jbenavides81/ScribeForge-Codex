import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.css';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { applyAppearance } from './appearance';
import { App } from './App';

const root = createRoot(document.getElementById('root') as HTMLElement);

if (window.scribeforge) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  // Opened in an ordinary web browser (for example the trial-mode address), not in the
  // ScribeForge window: the screens can't open files or save settings from here.
  applyAppearance(DEFAULT_SETTINGS);
  root.render(
    <div className="sf-screen" data-testid="outside-app">
      <h1>ScribeForge runs as a Windows app</h1>
      <p>This page is only the screens' development address. Use the ScribeForge window that opened on your desktop.</p>
      <p className="sf-muted">If no window opened, start trial mode with: npm run trial</p>
    </div>,
  );
}
