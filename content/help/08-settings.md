# Settings

Changes in **Settings** apply straight away and are saved on this computer.

| Setting | What it does |
|---|---|
| Theme | Cathedral, Light, Dark, High Contrast, or Match system (follows Windows' light or dark mode) |
| Text size | Standard, Large or Larger, for every screen |
| Your name on annotations | Shown by other readers as the author of your highlights, notes and text boxes. Leave it empty to add no name. |
| Before saving, show what the new file carries | On by default. See [Saving and your original files](07-saving.md). |
| Image quality of redacted pages | 150, 200 (the default) or 300 dots per inch. See [Redacting](06-redacting.md). |
| Remember the files I open | Keeps the **Recent files** list on Start. Turning it off also clears the list. |

## Where settings are kept

In a small file in your Windows profile, at `%APPDATA%\ScribeForge\settings.json`. It holds your choices and the recent-files list (file locations only, never copies of files), and never any passwords.

If the file is damaged, ScribeForge starts with its default settings, keeps the old file alongside, and tells you.
