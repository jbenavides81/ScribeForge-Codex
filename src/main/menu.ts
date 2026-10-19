import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../shared/api';

export function buildMenu(win: BrowserWindow): void {
  const send = (command: MenuCommand) => () => win.webContents.send('menu', command);
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: '&Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: '&Save as new file…', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: '&Close document', accelerator: 'CmdOrCtrl+W', click: send('close-document') },
        { type: 'separator' },
        { label: '&Settings', click: send('show-settings') },
        { type: 'separator' },
        { label: 'E&xit', role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: '&Copy', role: 'copy' },
        { label: 'Select &all', role: 'selectAll' },
        { type: 'separator' },
        { label: '&Find…', accelerator: 'CmdOrCtrl+F', click: send('find') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Zoom &in', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Zoom &out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: 'Fit &width', accelerator: 'CmdOrCtrl+0', click: send('zoom-fit-width') },
        { label: 'Fit &page', accelerator: 'CmdOrCtrl+9', click: send('zoom-fit-page') },
        { type: 'separator' },
        { label: '&Thumbnails', accelerator: 'CmdOrCtrl+T', click: send('toggle-thumbnails') },
        { label: '&Pages', accelerator: 'CmdOrCtrl+Shift+P', click: send('show-pages') },
        { label: '&Details', accelerator: 'CmdOrCtrl+Shift+D', click: send('show-details') },
      ],
    },
    {
      label: '&Help',
      submenu: [{ label: '&About ScribeForge', click: send('show-about') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
