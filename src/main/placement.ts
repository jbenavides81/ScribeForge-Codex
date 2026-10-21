import { screen, type BrowserWindow } from 'electron';

// Where the window appears. Normal use: centred on the main display, shown when ready.
// Test runs set SCRIBEFORGE_TEST_WINDOW=left: the window opens on the left-most monitor, never
// takes keyboard focus, and lets the real mouse pass through it, so you can keep working on
// another screen while tests run. (The tests drive the window directly, not through Windows'
// mouse. A real mouse move crossing the window mid-drag used to end a test's text selection
// early.)
// (Same idea as BC6 Business Manager's placement setting; to be matched to BC6's version.)

export function isTestWindow(): boolean {
  return process.env.SCRIBEFORGE_TEST_WINDOW === 'left';
}

export function placeAndShow(win: BrowserWindow): void {
  if (!isTestWindow()) {
    win.once('ready-to-show', () => win.show());
    return;
  }
  const displays = screen.getAllDisplays();
  const left = displays.reduce((a, b) => (b.bounds.x < a.bounds.x ? b : a), displays[0]);
  const area = left.workArea;
  const [w, h] = win.getSize();
  win.setBounds({
    x: area.x + Math.max(0, Math.floor((area.width - w) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - h) / 2)),
    width: Math.min(w, area.width),
    height: Math.min(h, area.height),
  });
  win.setIgnoreMouseEvents(true);
  win.once('ready-to-show', () => win.showInactive());
}
