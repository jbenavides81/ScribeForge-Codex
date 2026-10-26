# Getting ScribeForge

New versions of ScribeForge are published on its releases page. **About** has a button that opens it in your web browser. ScribeForge never checks for new versions itself, since it never connects to the internet.

## Installing a new version

1. On the releases page, download **ScribeForge Setup** with the newest version number.
2. Run it. Your settings, recent files and the Archive's vault stay as they are.

The installer isn't signed, so Windows shows "Windows protected your PC" the first time: click **More info**, then **Run anyway**. Signing costs money or needs the project to meet other conditions, so ScribeForge isn't signed for now. Checking the download, below, shows it's the one published.

## Checking a download

Each release lists a checksum for its installer: a long code that changes completely if even one byte of the file is different.

1. Open **PowerShell** in the folder you downloaded the installer to (in File Explorer, type `powershell` in the address bar and press Enter).
2. Type `Get-FileHash ".\ScribeForge Setup 1.10.0.exe"`, with the version you downloaded, and press Enter.
3. Compare the **Hash** it shows with the one on the releases page. If they're the same, the download is exactly the one published.

The releases page also lists checksums for ScribeForge's own files, `ScribeForge.exe` and `resources\app.asar`, in the folder it's installed in. These come out the same every time a version is built, so someone who builds ScribeForge from its source code can check the app matches it.

## What the version number means

- **The last number** (1.9.**1**) changes for fixes only.
- **The middle number** (1.**10**.0) changes for new features. Everything made by an older version still opens.
- **The first number** (**2**.0.0) changes when something made by an older version (a vault, a backup or a setting) can't be used any more, or a feature is removed.

The version you have is on the **About** screen.
