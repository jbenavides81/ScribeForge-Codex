# Security

ScribeForge handles people's private documents, so security problems are taken seriously and fixed first.

## Reporting a problem privately

Please don't report a security problem in a public issue. Instead, use GitHub's private reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe what you found and how to make it happen again.

Only the maintainer sees the report until it's fixed, and the answer comes there too.

Please don't include real private documents. If a particular file is needed, make a test file that shows the problem.

## What counts

Anything that could expose someone's documents or break ScribeForge's promises, for example:

- redacted text that can still be found in a redacted file;
- the Archive's vault, or a backup of it, opened or read without the password or recovery code;
- a document, title or note readable in the vault's files or the backup folder;
- ScribeForge making a network request of any kind;
- JavaScript in a PDF running;
- a file that ScribeForge changes when it only opens or reads it;
- a signature check that says a changed file is unchanged.

## Which versions

Fixes go into the newest version. Releases are listed on the repository's **Releases** page.
