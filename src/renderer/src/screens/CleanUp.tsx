import type { ReactNode } from 'react';
import type { CleanOptions, FileReport } from '../../../engine/types';
import { Icon } from '../components/Icon';
import { commentKinds, signaturesText } from '../details/describe';
import { plural } from '../words';

/** Everything ticked, with form fields and comments removed rather than burned in. */
export const CLEAN_EVERYTHING: CleanOptions = {
  details: true,
  attachments: true,
  formFields: 'remove',
  comments: 'remove',
  hiddenLayers: true,
  bookmarks: true,
  pageData: true,
};

function Section({ id, title, found, children }: { id: string; title: string; found: string; children?: ReactNode }) {
  return (
    <fieldset className="sf-section sf-clean-item" data-clean={id}>
      <legend>
        <h2>{title}</h2>
      </legend>
      <p className="sf-muted" data-testid={`clean-found-${id}`}>
        {found}
      </p>
      {children}
    </fieldset>
  );
}

/**
 * Clean up (codename Patchworks): make a copy of the file without what's ticked. It uses the same
 * list as the Details screen ("what this file carries").
 */
export function CleanUp({
  name,
  report,
  failed,
  choices,
  onChange,
  onClean,
  working,
}: {
  name: string;
  report: FileReport | null;
  failed: boolean;
  choices: CleanOptions;
  onChange: (choices: CleanOptions) => void;
  onClean: () => void;
  working: string | null;
}) {
  if (failed || !report) {
    return (
      <div className="sf-screen">
        <h1>Clean up</h1>
        <p className="sf-muted" role="status">
          {failed ? "ScribeForge couldn't read what this file carries, so it can't clean it up." : 'Reading the file…'}
        </p>
      </div>
    );
  }
  const c = report.carries;
  const set = (change: CleanOptions) => onChange({ ...choices, ...change });
  const tick = (key: 'details' | 'attachments' | 'hiddenLayers' | 'bookmarks' | 'pageData', label: string, disabled: boolean) => (
    <label className="sf-choice">
      <input type="checkbox" checked={!disabled && choices[key] === true} disabled={disabled} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  const pick = (key: 'formFields' | 'comments', labels: { flatten: string; remove: string }, disabled: boolean) => (
    <div className="sf-choice-row" role="radiogroup" aria-label={key === 'formFields' ? 'Form fields' : 'Comments'}>
      {(
        [
          ['keep', 'Keep'],
          ['flatten', labels.flatten],
          ['remove', labels.remove],
        ] as const
      ).map(([value, label]) => (
        <label key={value} className="sf-choice">
          <input
            type="radio"
            name={`clean-${key}`}
            value={value}
            disabled={disabled}
            checked={(choices[key] ?? 'keep') === value}
            onChange={() => set({ [key]: value === 'keep' ? undefined : value })}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
  const pageFiles = c.attachments.filter((a) => a.page !== undefined).length;
  const docFiles = c.attachments.length - pageFiles;
  const hidden = c.layers.filter((l) => l.hidden).length;
  const chosen = Object.values(choices).some((v) => v !== undefined && v !== false);

  return (
    <div className="sf-screen sf-clean" data-testid="clean-screen">
      <h1>Clean up</h1>
      <p className="sf-muted">{name}</p>
      <p>
        Make a copy of this file without what you choose below. The copy is made from the pages as arranged on the Pages screen, with your annotations,
        like any new file. The file you opened isn't changed.
      </p>

      <Section id="details" title="Details" found={c.details.length > 0 ? `${plural(c.details.length, 'detail')}, such as the title and author${c.xmp === 'read' ? ', and a second copy in XMP format' : ''}.` : 'None.'}>
        {tick('details', "Remove the document's details (both copies, including any non-standard ones)", c.details.length === 0 && c.xmp === 'none')}
      </Section>

      <Section id="attachments" title="Attached files" found={c.attachments.length > 0 ? `${plural(pageFiles, 'file')} attached to pages, ${plural(docFiles, 'file')} attached to the whole document.` : 'None.'}>
        {tick('attachments', 'Remove files attached to pages', pageFiles === 0)}
        {docFiles > 0 && <p className="sf-muted">Files attached to the whole document are never copied into new files.</p>}
      </Section>

      <Section id="scripts" title="Scripts and actions" found={c.actions.length > 0 ? `${plural(c.actions.length, 'script or action', 'scripts or actions')}.` : 'None.'}>
        <p className="sf-muted">Always removed: ScribeForge never copies scripts or risky actions into new files. Web links and links to pages stay.</p>
      </Section>

      <Section id="signatures" title="Signatures" found={`${signaturesText(c.signatures)}.`}>
        <p className="sf-muted">A new file never keeps a signature or its box: a signature only holds for the exact file that was signed.</p>
      </Section>

      <Section id="formFields" title="Form fields" found={c.formFields.length > 0 ? `${plural(c.formFields.length, 'field')}, ${c.formFields.filter((f) => f.filled).length} filled in.` : 'None.'}>
        <p className="sf-muted">Kept, they look the same but can't be filled in. Burned in, what they show becomes part of the page and the fields and their data go. Removed, they're gone.</p>
        {pick('formFields', { flatten: 'Burn into the page', remove: 'Remove' }, c.formFields.length === 0)}
      </Section>

      <Section id="comments" title="Comments" found={c.comments.total > 0 ? `${commentKinds(c.comments.kinds)}${c.comments.authors.length > 0 ? `, by ${c.comments.authors.join(', ')}` : ''}.` : 'None.'}>
        <p className="sf-muted">Burned in, they keep their look but become part of the page: their text and replies go. Annotations you've added are included.</p>
        {pick('comments', { flatten: 'Burn into the page', remove: 'Remove' }, c.comments.total === 0)}
      </Section>

      <Section id="layers" title="Hidden layers" found={c.layers.length > 0 ? `${plural(c.layers.length, 'layer')}, ${hidden} hidden.` : 'None.'}>
        {tick('hiddenLayers', "Remove what's on hidden layers (the pages look the same; the hidden content is gone from the file)", hidden === 0)}
      </Section>

      <Section id="bookmarks" title="Bookmarks" found={c.bookmarks > 0 ? `${plural(c.bookmarks, 'bookmark')}.` : 'None.'}>
        {tick('bookmarks', 'Remove the bookmarks', c.bookmarks === 0)}
      </Section>

      <Section id="pagedata" title="Hidden page data" found={c.pageData > 0 ? `On ${plural(c.pageData, 'page')}: data other programs keep with a page, or a small picture of the page.` : 'None.'}>
        {tick('pageData', 'Remove hidden page data', c.pageData === 0)}
      </Section>

      <div className="sf-dialog-buttons sf-clean-buttons">
        <button type="button" className="sf-button" onClick={() => onChange(CLEAN_EVERYTHING)}>
          Choose everything
        </button>
        <button type="button" className="sf-button sf-primary" onClick={onClean} disabled={!chosen || working !== null}>
          <Icon name="save" size={18} />
          Clean up and save…
        </button>
      </div>
      {working && (
        <p className="sf-muted" role="status">
          {working}
        </p>
      )}
    </div>
  );
}
