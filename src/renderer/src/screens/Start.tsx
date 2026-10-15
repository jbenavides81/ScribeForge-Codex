import type { RecentFile } from '../../../shared/api';
import { Icon } from '../components/Icon';

export function Start({
  recent,
  rememberRecent,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onClearRecent,
}: {
  recent: RecentFile[];
  rememberRecent: boolean;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
}) {
  return (
    <div className="sf-screen sf-start">
      <h1>Open a PDF</h1>
      <p className="sf-muted">ScribeForge works entirely on this computer. It never connects to the internet and never changes the files you open.</p>

      <div className="sf-dropzone" data-testid="dropzone">
        <button type="button" className="sf-button sf-primary" onClick={onOpen}>
          <Icon name="open" />
          Open a PDF…
        </button>
        <p>or drag a PDF file here</p>
        <p className="sf-muted">Shortcut: Ctrl+O</p>
      </div>

      <section className="sf-section" aria-labelledby="recent-heading">
        <div className="sf-section-head">
          <h2 id="recent-heading">Recent files</h2>
          {rememberRecent && recent.length > 0 && (
            <button type="button" className="sf-button" onClick={onClearRecent}>
              Clear the list
            </button>
          )}
        </div>
        {!rememberRecent && <p className="sf-muted">Recent files are turned off in Settings.</p>}
        {rememberRecent && recent.length === 0 && <p className="sf-muted">Files you open will appear here.</p>}
        {rememberRecent && recent.length > 0 && (
          <ul className="sf-recent" data-testid="recent-list">
            {recent.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className="sf-recent-open"
                  onClick={() => onOpenRecent(file.path)}
                  disabled={!file.exists}
                  title={file.path}
                >
                  <Icon name="document" />
                  <span className="sf-recent-text">
                    <span className="sf-recent-name">{file.name}</span>
                    <span className="sf-muted">{file.exists ? file.folder : `Not found: ${file.folder}`}</span>
                  </span>
                </button>
                <button type="button" className="sf-icon-button" aria-label={`Remove ${file.name} from the list`} onClick={() => onRemoveRecent(file.path)}>
                  <Icon name="remove" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
