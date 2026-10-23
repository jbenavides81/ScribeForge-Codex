# Signing

**Sign** puts your certificate's signature on a PDF, and checks the signatures a PDF already has. Everything happens on this PC: ScribeForge never goes online.

A signature proves two things: that the file hasn't changed since it was signed, and which certificate signed it. Whose certificate that is depends on who vouches for it (see "Whose signature is it?" below).

## Signing a file

1. Click **Sign** on the left (or **View > Sign**), then **Sign this file…**.
2. Choose your certificate file (`.pfx` or `.p12`) and type its password. ScribeForge never saves the password. It remembers where the file is, like the recent files list, and forgets it when you clear that list.
3. Check whose certificate it is and when it's valid. ScribeForge warns you if it has expired or isn't meant for signing.
4. Choose how the signature looks:
    - **A box you draw on the page**, showing your name, the date and the reason. After you click **Draw the box…**, drag the box on the page; press `Esc` to cancel.
    - **An empty signature box the file already has**, as many forms do.
    - **Invisible**: no box on the page.
5. Add a reason and a place if you want, then sign. The signed file is saved as `<name> (signed).pdf`, and it opens.

The signature is added to the end of a copy of the file, so the copy starts with exactly the file you opened. Signatures already in the file stay valid. The file you opened isn't changed.

If the file has unsaved changes (moved pages, new comments, new details), a password or a damaged structure, ScribeForge makes the new file first, as **Save** does, and signs that. A signature already in the file can't come across into a new file, and ScribeForge says so first.

The signing time is this PC's clock. A trusted time stamp would need a time-stamp service on the internet, so ScribeForge doesn't add one.

## No certificate?

Click **Make a certificate…** on the Sign screen. It makes a certificate in your name, valid for five years, and saves it as a `.pfx` file protected by a password you choose. Keep the file safe and remember the password: ScribeForge can't get it back.

A certificate you make yourself issues itself, so nobody else vouches for it. Other people's readers will say its identity isn't confirmed, unless they choose to trust it. That's fine for your own records, and for people you can give your certificate to.

Certificates from a certificate company usually come as a `.pfx` or `.p12` file. ScribeForge reads files protected with AES (today's usual kind) or 3DES (Windows' older kind). For the oldest kind (RC2), it says how to save the file again: open it in Windows by double-clicking it, then export it again with AES256-SHA256. Certificates kept in Windows itself, or on smart cards and USB keys, can't be used yet.

## Checking signatures

When a signed file opens, a line under the toolbar says so, and the **Sign** screen lists each signature with what ScribeForge found:

| It says | What it means |
|---|---|
| **Valid** | The file hasn't changed since it was signed. |
| **Valid**, only other signatures added after it | The file was signed again later, and nothing else changed. |
| **Changed after signing** | Something other than a signature was added after it. The signature is for an earlier version of the file. |
| **Not valid** | The file doesn't match the signature, the signature is damaged, or it uses an old method that can be forged (SHA-1 or MD5). |
| **Can't be checked** | A kind of signature ScribeForge can't read, or a time stamp from a time-stamp service. |

**Open the signed version** opens exactly what that person signed, as a separate file in ScribeForge. Use it when a file was changed after signing, to see what was really signed. Nothing is saved unless you save it.

ScribeForge is strict about what counts as "only other signatures": anything else added later, even a comment, counts as a change. Some other readers allow comments and form filling after some signatures.

## Whose signature is it?

Anyone can make a certificate with any name on it, so a name alone proves nothing. A signature's identity is **confirmed** when its certificate leads back to one that's trusted:

- **Windows' trusted certificates on this PC**, the ones Windows uses for websites;
- **certificates you chose to trust**: click **Trust this certificate…** on a signature. Only do this if you know the certificate is that person's, for example because they gave it to you or read you its fingerprint. Your list is on the Sign screen, and **Remove** takes one off it.

Otherwise the signature says "Identity not confirmed". Adobe uses its own list of trusted certificates, and the European Union has one too; both come from the internet. Windows also fetches some of its trusted certificates from the internet only when it needs them. So a signature Adobe trusts may say "Identity not confirmed" in ScribeForge.

ScribeForge also checks that each certificate along the way may vouch for others, and was valid when the signature was made.

## What can't be checked without the internet

- **Whether a certificate was cancelled** (revoked) by whoever issued it.
- **When the file was really signed.** The time comes from the signer's computer clock. A time stamp from a time-stamp service would prove it; ScribeForge says when a signature has one, but doesn't check it yet.

## Signed files and other tools

A signature holds only for the exact file that was signed. **Save**, **Pages**, **Redact** and **Clean up** all make a new file, so a new file never keeps a signature: not the signature itself, and not its box, which would make the new file look signed when it isn't. ScribeForge asks before saving a signed file this way.

To check signatures from a script, see `scribeforge verify` in [Command line](12-command-line.md).
