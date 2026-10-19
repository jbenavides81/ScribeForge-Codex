import type { DocInfo, FileReport } from '../../../engine/types';
import { CarriesList } from '../details/CarriesList';
import { formatDate, pageSize, restrictions } from '../details/describe';
import { plural } from '../words';

const FIELDS: { id: keyof DocInfo; label: string; help?: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
  { id: 'subject', label: 'Subject' },
  { id: 'keywords', label: 'Keywords', help: 'Separate keywords with commas.' },
];

const FIELD_NAMES: Record<keyof DocInfo, string> = { title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords' };

/** The open file's details (editable for the new file) and what it carries. */
export function Details({
  name,
  report,
  failed,
  values,
  changed,
  onChange,
  onReset,
  password,
  permissions,
}: {
  name: string;
  report: FileReport | null;
  failed: boolean;
  values: DocInfo;
  changed: boolean;
  onChange: (field: keyof DocInfo, value: string) => void;
  onReset: () => void;
  /** True when the file needed a password to open. */
  password: boolean;
  /** What a locked file's author allows (pdf.js flags), or null when it has no restrictions. */
  permissions: number[] | null;
}) {
  if (failed) {
    return (
      <div className="sf-screen">
        <h1>Details</h1>
        <p>ScribeForge couldn't read this file's details. You can still view it and save its pages.</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="sf-screen">
        <h1>Details</h1>
        <p className="sf-muted" role="status">
          Reading the file…
        </p>
      </div>
    );
  }

  const { details, carries } = report;
  const limits = restrictions(permissions);
  const locked = password
    ? 'Yes. It needs a password to open.'
    : details.encrypted
      ? `Yes. It opens without a password, but its author doesn't allow ${limits.length > 0 ? limits.join(', ') : 'some things'}.`
      : 'No';

  return (
    <div className="sf-screen sf-details" data-testid="details-screen">
      <h1>Details</h1>
      <p className="sf-muted">{name}</p>

      {details.disagreements.length > 0 && (
        <div className="sf-banner sf-notice" data-testid="details-disagree">
          <p>This file keeps its details twice, and the two copies disagree:</p>
          <ul>
            {details.disagreements.map((d) => (
              <li key={d.field}>
                {FIELD_NAMES[d.field]}: "{d.info}" in one copy, "{d.xmp}" in the other (XMP).
              </li>
            ))}
          </ul>
          <p>When you save, both copies in the new file get the values below.</p>
        </div>
      )}
      {details.xmp.state === 'unreadable' && (
        <div className="sf-banner sf-notice" data-testid="details-unreadable">
          <p>
            This file has a second copy of its details, in XMP format, that ScribeForge can't read. The new file gets a fresh copy that matches the
            details below.
          </p>
        </div>
      )}

      <section className="sf-section" aria-labelledby="details-edit">
        <div className="sf-section-head">
          <h2 id="details-edit">Document details</h2>
          {changed && (
            <button type="button" className="sf-button" onClick={onReset}>
              Undo my changes
            </button>
          )}
        </div>
        <p className="sf-muted">Changes go into the new file when you save. The file you opened isn't changed.</p>
        <div className="sf-details-fields">
          {FIELDS.map((f) => (
            <div key={f.id} className="sf-field">
              <label htmlFor={`details-${f.id}`}>{f.label}</label>
              <input
                id={`details-${f.id}`}
                type="text"
                value={values[f.id]}
                spellCheck={false}
                autoComplete="off"
                aria-describedby={f.help ? `details-${f.id}-help` : undefined}
                onChange={(e) => onChange(f.id, e.target.value)}
              />
              {f.help && (
                <span id={`details-${f.id}-help`} className="sf-muted">
                  {f.help}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="sf-section" aria-labelledby="details-about">
        <h2 id="details-about">About this file</h2>
        <dl className="sf-facts" data-testid="details-facts">
          <dt>Made with</dt>
          <dd>{details.info.creator || 'Not recorded'}</dd>
          <dt>PDF made by</dt>
          <dd>{details.info.producer || 'Not recorded'}</dd>
          <dt>Created</dt>
          <dd>{formatDate(details.created) || 'Not recorded'}</dd>
          <dt>Last changed</dt>
          <dd>{formatDate(details.modified) || 'Not recorded'}</dd>
          <dt>PDF version</dt>
          <dd>{details.version || 'Unknown'}</dd>
          <dt>Pages</dt>
          <dd>
            {details.pageSizes.length === 1
              ? `${plural(details.pageCount, 'page')}, ${pageSize(details.pageSizes[0].width, details.pageSizes[0].height)}`
              : plural(details.pageCount, 'page')}
            {details.pageSizes.length > 1 && (
              <ul className="sf-carries-items">
                {details.pageSizes.map((s) => (
                  <li key={`${s.width}x${s.height}`}>
                    {plural(s.count, 'page')}: {pageSize(s.width, s.height)}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Password or restrictions</dt>
          <dd>{locked}</dd>
        </dl>
        {details.encrypted && <p className="sf-muted">New files made by ScribeForge have no password and no restrictions.</p>}
      </section>

      <section className="sf-section" aria-labelledby="details-carries">
        <h2 id="details-carries">What this file carries</h2>
        <p className="sf-muted">Besides what's on its pages. Before you save, ScribeForge shows the same list for the new file.</p>
        <CarriesList carries={carries} />
      </section>
    </div>
  );
}
