import notices from '../../../../THIRD-PARTY-NOTICES.md?raw';
import { RELEASES_URL } from '../../../shared/project';
import { Icon } from '../components/Icon';

const api = window.scribeforge;

export function About({ version, trial }: { version: string; trial: boolean }) {
  return (
    <div className="sf-screen sf-about">
      <div className="sf-about-head">
        <span className="sf-about-logo">
          <Icon name="logo" size={96} />
        </span>
        <div>
          <h1>ScribeForge</h1>
          <p data-testid="about-version">Version {version}{trial ? ' (trial mode)' : ''}</p>
          <p className="sf-accent">by BC6</p>
        </div>
      </div>
      <p>An open-source, offline PDF toolkit for Windows.</p>
      <ul className="sf-plain-list">
        <li>ScribeForge never connects to the internet.</li>
        <li>It never changes the files you open. Edits are saved to new files.</li>
        <li>Content in your PDFs that tries to run code (PDF JavaScript) is never run.</li>
      </ul>
      <p>
        ScribeForge is open-source software under the Apache License 2.0.
      </p>
      <section className="sf-section" aria-labelledby="about-releases">
        <h2 id="about-releases">New versions</h2>
        <p>ScribeForge never checks for new versions itself. They're published on its releases page, with what's new and how to check the download.</p>
        <button type="button" className="sf-button" onClick={() => void api.openLink(RELEASES_URL)}>
          Open the releases page in your browser
        </button>
        <p className="sf-muted sf-address" data-testid="releases-address">
          {RELEASES_URL}
        </p>
      </section>
      <details className="sf-section sf-notices">
        <summary>Third-party notices</summary>
        <pre data-testid="notices">{notices}</pre>
      </details>
    </div>
  );
}
