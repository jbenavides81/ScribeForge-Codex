import type { ReactNode } from 'react';
import type { Carries } from '../../../engine/types';
import { plural } from '../words';
import { actionText, commentKinds, DETAIL_LABELS, detailValue, sizeText } from './describe';

const SHOWN = 8;

/** A list, cut off after a few items with "and N more" unless `all` is set. */
function Items({ items, all = false }: { items: string[]; all?: boolean }) {
  if (items.length === 0) return null;
  const shown = all ? items.length : SHOWN;
  const more = items.length - shown;
  return (
    <ul className="sf-carries-items">
      {items.slice(0, shown).map((item, i) => (
        <li key={i}>{item}</li>
      ))}
      {more > 0 && <li className="sf-muted">and {plural(more, 'more', 'more')}</li>}
    </ul>
  );
}

function Row({ label, summary, children, id }: { label: string; summary: string; children?: ReactNode; id: string }) {
  return (
    <div className="sf-carries-row" data-carries={id}>
      <dt>{label}</dt>
      <dd>
        <span className={summary === 'None' ? 'sf-muted' : undefined}>{summary}</span>
        {children}
      </dd>
    </div>
  );
}

/** Everything a file carries besides what's drawn on its pages. */
export function CarriesList({ carries }: { carries: Carries }) {
  const c = carries;
  const filled = c.formFields.filter((f) => f.filled).length;
  const hidden = c.layers.filter((l) => l.hidden).length;
  const links = [
    c.links.webLinks > 0 ? plural(c.links.webLinks, 'web or email link') : '',
    c.links.pages > 0 ? plural(c.links.pages, 'link to a page', 'links to pages') : '',
    c.links.otherFiles > 0 ? plural(c.links.otherFiles, 'link to another file', 'links to other files') : '',
  ].filter(Boolean);

  return (
    <dl className="sf-carries" data-testid="carries">
      <Row id="details" label="Details" summary={c.details.length > 0 ? plural(c.details.length, 'detail') : 'None'}>
        <Items all items={c.details.map((d) => `${DETAIL_LABELS[d.key] ?? d.key}: ${detailValue(d.key, d.value)}`)} />
        {c.xmp === 'read' && <p className="sf-muted">A second copy is kept in XMP format, which many programs read first.</p>}
        {c.xmp === 'unreadable' && <p className="sf-muted">There's also a second copy in XMP format that ScribeForge can't read.</p>}
      </Row>
      <Row id="attachments" label="Attached files" summary={c.attachments.length > 0 ? plural(c.attachments.length, 'file') : 'None'}>
        <Items
          items={c.attachments.map((a) => [a.name, a.size !== undefined ? sizeText(a.size) : '', a.page ? `on page ${a.page}` : 'attached to the whole file'].filter(Boolean).join(', '))}
        />
      </Row>
      <Row
        id="form-fields"
        label="Form fields"
        summary={c.formFields.length > 0 ? `${plural(c.formFields.length, 'field')}, ${filled} filled in` : 'None'}
      >
        <Items items={c.formFields.map((f) => `${f.name || 'Unnamed field'}${f.filled ? ' (filled in)' : ''}`)} />
      </Row>
      <Row id="comments" label="Comments" summary={c.comments.total > 0 ? commentKinds(c.comments.kinds) : 'None'}>
        {c.comments.authors.length > 0 && <p>By {c.comments.authors.join(', ')}</p>}
      </Row>
      <Row id="scripts" label="Scripts and actions" summary={c.actions.length > 0 ? plural(c.actions.length, 'script or action', 'scripts or actions') : 'None'}>
        <Items items={c.actions.map(actionText)} />
        {c.actions.length > 0 && <p className="sf-muted">ScribeForge never runs them.</p>}
      </Row>
      <Row id="bookmarks" label="Bookmarks" summary={c.bookmarks > 0 ? plural(c.bookmarks, 'bookmark') : 'None'} />
      <Row id="layers" label="Layers" summary={c.layers.length > 0 ? `${plural(c.layers.length, 'layer')}, ${hidden} hidden` : 'None'}>
        <Items items={c.layers.map((l) => `${l.name || 'Unnamed layer'}${l.hidden ? ' (hidden)' : ''}`)} />
        {hidden > 0 && <p className="sf-muted">What's on a hidden layer is still in the file. Anyone can show it.</p>}
      </Row>
      <Row id="links" label="Links" summary={links.length > 0 ? links.join(', ') : 'None'}>
        <Items items={c.links.web} />
      </Row>
      <Row id="locked" label="Password or restrictions" summary={c.encrypted ? 'Yes' : 'None'} />
    </dl>
  );
}
