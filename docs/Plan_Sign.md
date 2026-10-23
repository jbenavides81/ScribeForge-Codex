# ScribeForge: signing plan (stop 2e, "Sealkeeper")

_2026-10-22. **Approved 2026-10-22,** with every recommendation in section 12 accepted._

Stop 2e adds signing: putting a certificate signature on a PDF, and checking the signatures a PDF already has. The Phase 2 plan (section 8) said signing needs its own research and plan before any code. This is that plan.

**The short version:**
- **Signing works.** I tested it from start to finish on this PC and signed three test PDFs. Two separate checkers, OpenSSL and pyHanko (a well-known PDF signature checker), both found every signature intact and valid. Both also caught a single changed byte.
- **A signature is added to the end of the file.** The signed file starts with the original, byte for byte, so signatures already in it stay valid. Tested: a file signed twice keeps both signatures valid.
- **Two packages, both with the BSD licence:** pkijs and asn1js, plus five small helpers they need. I recommend against node-forge, which the Phase 2 plan named. It had seven security fixes in the last year, six of them rated high, and it can't read newer kinds of keys.
- **Checking works without the internet, with limits.** ScribeForge can tell whether a file has changed since it was signed, and whose name the certificate gives. It can say whether that certificate leads back to one Windows trusts, or to one you chose to trust. It can't tell whether a certificate was cancelled, because that needs the internet.
- **A problem to fix:** today, a new file made from a signed PDF keeps the signature's box on the page. It looks signed, but it isn't.
- **In this stop, certificates come from a `.pfx` or `.p12` file.** Certificates in Windows' own store and on smart cards would need a native part, so they'd get a later plan.

---

## 1. What I tested (2026-10-22)

These were small experiments in a scratch folder; none of them are kept. They used the app's own versions: Electron 44.7.2 (with Node 24.21), pdf.js 6.4.299 and @cantoo/pdf-lib 2.11.1. The test certificates were made up and made with OpenSSL 3.5.7.

| # | Question | Result | What 2e does |
|---|---|---|---|
| S1 | Which signing packages are current and safe? | **pkijs** 3.4.3 (21 Oct 2026) and **asn1js** 3.0.10 (April 2026), both BSD-3-Clause. pkijs 4.0.0 came out today and asn1js 4.0.0 three days ago; both are big changes. **node-forge** 1.4.0 (BSD or GPL) fixed four high-severity problems in March 2026, including forged signatures passing its check and a flaw in its certificate-chain check, and three more in November 2025. **@signpdf** 4.0.0 (MIT) came out three days ago. | Use pkijs 3.4.3 and asn1js 3.0.10 (question 1). |
| S2 | Can they read certificate files (`.pfx`, `.p12`)? | **Neither reads every kind alone.** pkijs reads today's files (AES encryption), including newer EC keys, but not older ones (3DES or RC2). node-forge reads 3DES and RC2 files but not EC keys. Node's own encryption, with about 40 lines of ScribeForge code for the PKCS#12 key step (RFC 7292, appendix B), unlocks 3DES files. With that, pkijs read every kind except the oldest (RC2). In Electron, RC2 fails. A wrong password gives a clear error in both packages. | Read AES and 3DES files, with RSA or EC keys. RC2 files get a plain message saying how to re-save them (section 3). |
| S3 | Does @signpdf work with the pdf-lib fork? | **Not as it comes.** Its pdf-lib helper installs the original pdf-lib 1.17.1 (22 MB), and its certificate-file signer needs node-forge. Its core is small: it finds the signature's space in the file and fills it in. | Don't use @signpdf. ScribeForge writes the signature's space itself with the fork, which is about as much code as @signpdf's helper. |
| S4 | Can the fork add a signature to the end of a file? | **Yes.** It adds the signature's box, its look and the form entry as a separate block at the end (`saveIncremental`, an "incremental update", ISO 32000-1 section 7.5.6). In all three files, the signed file started with the original's exact bytes, one of them `carries.pdf` with its form fields. A signature takes 2.3 KB with an RSA key and two certificates, or 0.8 KB with an EC key. | This is how ScribeForge signs. |
| S5 | Would other programs accept these signatures? | **Yes, by two separate checkers.** OpenSSL's `cms -verify` passed all three files, with RSA and EC keys, and failed a copy with one changed byte. pyHanko 0.38.0 reported every signature intact, valid and trusted (trusting the test certificate). In the twice-signed file, it said the first signature covers "the entire revision", and that what came after it was the kind of change allowed after a signature: adding a signature. | Tests check every signed file a second way (section 9). |
| S6 | Does the viewer show signatures? | **pdf.js shows the box but doesn't check it.** It drew the visible signature (2,160 pixels differed from the unsigned page) and reported it as a signature field with its name. | ScribeForge does the checking itself. |
| S7 | What does ScribeForge do with a signed file today? | **Two things to fix.** Details counts each signature as a "form field, filled in". A new file made from a signed file keeps the signature's look (0 pixels differed) and its signature data, but not as a signature. The new file looks signed, but isn't. | Fixed in 2e (section 2). |
| S8 | Can pkijs check signatures inside Electron? | **Yes.** It confirmed each file was unchanged and named the signer. It accepted the certificate chain when the test certificate was trusted, and said "no valid certificate path" when only Windows' certificates were trusted, as it should. One changed byte gave "message digest doesn't match". | pkijs does the checking, with ScribeForge's own extra checks on each certificate (section 5). |
| S9 | Can ScribeForge read Windows' list of trusted certificates without going online? | **Yes, but the list isn't exactly Windows' trusted list.** Node reads it from this PC (`tls.getCACertificates('system')`): 171 entries, 92 of them different. That includes 26 "intermediate" certificates that Windows keeps but doesn't trust on their own, and leaves out 12 of the 79 certificates Windows trusts. _Needs verification: Node seems to keep only certificates Windows trusts for websites, which would explain the 12._ | Use only the top-level certificates from it, plus your own list (question 6). |
| S10 | Can I check against Adobe? | **Not on this PC.** Adobe Acrobat and Adobe Reader aren't installed. Microsoft Edge shows signature boxes but doesn't check signatures. | The manual script includes an optional check in Adobe Acrobat Reader. _Needs verification._ |

---

## 2. What you'll be able to do

### Seeing a file's signatures

- A new **Sign** screen on the left, with a seal icon, lists the file's signatures. Each one shows who signed, when, the reason they gave, and the result of the check (section 5).
- When a signed file opens, a short note under the toolbar says so: "This file has 2 signatures. All are valid." It links to the Sign screen.
- **Open the signed version.** For any signature, this opens exactly what that person signed, as a separate file in ScribeForge. This matters when a file was changed after signing. Nothing is saved unless you save it.
- **Details** lists signatures on their own row. They're no longer counted as form fields.

### Signing

1. On the Sign screen, click **Sign this file…**, choose your certificate file, and type its password. ScribeForge never saves the password.
2. ScribeForge shows whose name the certificate gives, who issued it, and when it's valid from and to. It warns if the certificate has expired or isn't meant for signing.
3. Choose how the signature looks:
   - a box you draw on the page (the default);
   - an empty signature box the file already has, as many forms do ("sign here");
   - invisible.
4. Add a reason and a place if you want, such as "I approve this document" and "Head office". The name comes from the certificate.
5. Click **Sign and save…**. The file is saved as `<name> (signed).pdf` and opens, showing the new signature as valid.

**If the file has unsaved changes**, such as moved pages or new comments, ScribeForge builds the new file first, as **Save** does, and signs that, in one step. If the original was already signed, those older signatures can't come across, and ScribeForge says so before signing.

### Signed files and ScribeForge's other tools

A signature holds only for the exact bytes that were signed. Every ScribeForge save except signing builds a new file: Save, Pages, Redact and Clean up. So:
- **New files leave signatures out completely:** the signature data and the box's look on the page. Today the look stays, which makes a new file seem signed (S7).
- **Before saving a signed file, ScribeForge says so:** "This file is signed. The new file won't be: a signature only holds for the exact file that was signed."
- **Clean up** lists "Signatures: a new file can't keep them", the same way it lists scripts.

---

## 3. Where certificates come from (question 2)

- **In this stop: certificate files** (`.pfx` or `.p12`), protected by a password. This is how certificates from a certificate company usually arrive, and what Windows' "Export" makes.
  - Readable: files saved with AES (today's default) or 3DES (Windows' older default), holding an RSA or EC key.
  - Not readable: the oldest kind (RC2), still made by some older programs, such as OpenSSL before version 3 (2021). ScribeForge says: "This certificate file uses an old kind of protection that ScribeForge can't read. Open it in Windows (double-click it), then export it again with 'AES256-SHA256'."
- **Make your own certificate** (question 3). This creates a certificate in your name and saves it as a `.pfx` file, protected by a password you choose. It's free and instant. Other people's readers will show it as "identity not confirmed" unless they choose to trust it. That's fine for your own records, and for people you can send your certificate to.
- **Later, with its own plan if you want it:** certificates in Windows' own store and on smart cards or USB keys. Electron can't use Windows' own signing functions, so these would need a native part (a small C++ module) or a call to PowerShell for each signature.

---

## 4. What a signature looks like (questions 4 and 5)

- **The visible box** reads:
  > Signed by Alex Example
  > 22 Oct 2026, 14:44
  > Reason: I approve this document

  It's drawn in the same font as ScribeForge's text boxes, with a thin border. No picture of a handwritten signature in this stop.
- **Inside the file**, it's the standard kind other readers check:
  - the European standard PAdES (baseline B-B), named `ETSI.CAdES.detached` in the file (ISO 32000-2 section 12.8.3.4; ETSI EN 319 142-1);
  - SHA-256;
  - your certificate and the certificates that lead to its issuer, which come from the certificate file.

  The S5 checks used exactly this kind.
- **The signing time** is this PC's clock. A trusted time stamp would need a time-stamp service on the internet, so ScribeForge doesn't add one.

---

## 5. Checking signatures without the internet

### What ScribeForge checks

1. **Has the file changed?** It checks that the signature covers the whole file up to the signature, and that the signature's maths match those bytes (RFC 5652).
2. **Was anything added after it?** If more was saved after a signature, ScribeForge looks at each later addition. It counts as "only another signature" only if it adds just a signature: a new signature field, its box and look, and the lists that point to them. **Anything else counts as "changed after signing"**, because known attacks hide changes to a page inside a later addition. This is stricter than Adobe, which also allows form filling and comments after some signatures. When ScribeForge says "changed", **Open the signed version** shows exactly what was signed.
3. **Who signed?** The name on the certificate, and whether the certificate leads back to one that's trusted (RFC 5280). As well as pkijs's own chain check, ScribeForge checks each certificate itself:
   - every certificate in the chain is allowed to issue certificates;
   - the signer's certificate is meant for signing;
   - each certificate was valid at the signing time.
4. **Was a safe method used?** Signatures that use SHA-1, which can be forged, count as not valid.

### What it can't check

- **Whether a certificate was cancelled (revoked)**, which needs the internet. Every signature says "Not checked: whether the certificate was cancelled. That needs the internet."
- **When it was really signed.** The time comes from the signer's computer clock. If a signature has a time stamp from a service, ScribeForge says so but doesn't check it yet.

### Who is trusted (question 6)

- **Windows' trusted certificates on this PC.** ScribeForge uses only the top-level ones (S9).
- **Certificates you choose to trust.** On any signature, **Trust this certificate…** shows the certificate's name and fingerprint and asks first. Your list is kept in settings (certificates only; they hold nothing secret), can be seen on the Sign screen, and each one can be removed.
- **Adobe's own list and the European list come from the internet**, and Windows downloads some of its trusted certificates only when it needs them. So a signature that Adobe trusts may say "identity not confirmed" in ScribeForge. The help page explains this.

### What it says

The result, in a word and a sentence:

| Found | ScribeForge says |
|---|---|
| Matches, nothing after it | **Valid.** The file hasn't changed since Alex Example signed it. |
| Matches, only signatures after it | **Valid.** Only other signatures were added after it. |
| Matches, other changes after it | **Changed after signing.** Alex Example signed an earlier version. Open the signed version to see what they signed. |
| Doesn't match | **Not valid.** The file doesn't match this signature. It was changed, or the signature is damaged. |
| Can't be read | **Can't be checked.** ScribeForge can't read this kind of signature. |

Then who signed:
- "Certificate: Alex Example, issued by Example CA. Windows on this PC trusts Example CA."
- Or: "… You chose to trust this certificate."
- Or: "**Identity not confirmed.** Anyone can make a certificate with any name. Trust this certificate… only if you know it's theirs."
- Plus "The certificate had expired when it was signed" or "wasn't valid yet", when that's the case.

---

## 6. How it's built

- **Your certificate's secret key stays away from PDF content.**
  - The PDF side of the app, which handles untrusted files, prepares the file and works out the fingerprint (hash) of the bytes to sign.
  - The main part of the app, which never reads PDFs, opens the certificate file with your password, makes the signature, and passes back only the signature.
  - The password and key are dropped from memory straight after.
- **Checking runs on the PDF side**, with the trusted certificates passed to it.
- The signature's space in the file is sized from your certificates, with room to spare. If a signature doesn't fit, nothing is saved.
- The code goes in `src/engine/sign/`; the Sign screen is `screens/Sign.tsx`.

---

## 7. Dependencies (question 1)

| Package | Version | Licence | Unpacked size | Ships? | Why |
|---|---|---|---|---|---|
| pkijs | 3.4.3 | BSD-3-Clause | 1.9 MB | Yes | Reads certificate files, makes signatures and checks them |
| asn1js | 3.0.10 | BSD-3-Clause | 0.3 MB | Yes | Reads and writes the format certificates and signatures are stored in; pkijs needs it |
| bytestreamjs | 2.0.1 | BSD-3-Clause | 0.2 MB | Yes | Needed by pkijs |
| @noble/hashes | 1.8.0 | MIT | 1.6 MB | Yes | pkijs's own hashing |
| pvtsutils, pvutils | 1.3.6, 1.2.0 | MIT | 0.1 MB | Yes | Small helpers for pkijs |
| tslib | 2.8.1 | 0BSD | 0.1 MB | Yes | Needed by pvtsutils |

- **Why nothing already included will do:** Node can make and check the raw maths of a signature, but it can't read certificate files or the signature format PDFs use (CMS). pdf-lib doesn't sign.
- **Most are already on this PC.** pkijs 3.4.1, asn1js 3.0.10 and most of the helpers came with electron-builder, but only for building the installer. 2e makes them part of the app and records them in `THIRD-PARTY-NOTICES.md`.
- _Needs verification: how much the installer grows. I'll measure it in the stop. Only the parts used are bundled._
- **Not used:**
  - node-forge, for its security record and because it lacks EC keys (S1, S2);
  - @signpdf (S3);
  - pkijs 4 and asn1js 4, which are only days old. Moving to them can come later, once they've settled.

---

## 8. The command-line tool (question 8)

`scribeforge verify report.pdf` prints each signature's result, in the same words as the app.
- `--json` gives the result in a form scripts can read.
- `--trust certificate.cer` trusts a certificate for this check; it can be given more than once. Windows' trusted certificates count too.
- The exit code is 0 when every signature is valid and its identity confirmed, and 3 otherwise.
- `scribeforge info` also lists the signatures.

Signing from the command line waits, unless you want it now.

---

## 9. Required checks

- **Every signed test file passes a second, separate check**, made with Node's own crypto instead of pkijs.
- **A signed file starts with the original's exact bytes.** Signing it again keeps the first signature valid.
- **Each result in section 5 comes out right on a test file made for it.** The fixture script makes these files and their made-up certificates with pkijs:
  - valid;
  - signed twice;
  - page changed after signing;
  - a hidden change added together with a later signature (says "changed after signing");
  - one byte changed (not valid);
  - expired certificate;
  - identity not confirmed, and then confirmed after **Trust this certificate**;
  - a chain whose middle certificate isn't allowed to issue certificates (not trusted);
  - SHA-1 (not valid);
  - a signature in the style other programs make (`adbe.pkcs7.detached`, with a signing-time entry).
- **Certificate files:** AES and 3DES files, with RSA and EC keys, all sign. A wrong password and an RC2 file each give their plain message.
- **New files made from a signed file** contain no signature, signature field or signature look, and the warning comes first.
- **The password and key are never written anywhere.** After signing, a test searches the settings file and the app's data folder for them.
- **No network requests**, as every stop. Checking never goes online.
- **`scribeforge verify`** gives the same results and the right exit codes.
- **The manual script** opens a signed file in Microsoft Edge, which shows the box. If you have Adobe Acrobat Reader (free), it also opens the file there, which should say the signature is valid and the identity unknown. _Needs verification: Adobe isn't on this PC._

---

## 10. Not in this stop

Each of these could come later, if you want it, with its own plan where it's big:
- time stamps from a time-stamp service, and checking whether certificates were cancelled (both need the internet);
- certificates in Windows' store and on smart cards (section 3);
- "certifying" signatures, which lock a file against changes;
- signing a password-protected file and keeping its password. In 2e, signing such a file signs a new copy without the password, after asking, as Save does today;
- adding comments to a signed file without breaking its signatures;
- signing from the command line;
- checking a signature's time stamp.

---

## 11. Version, help and the manual test

- **Version 1.5.0**, as the Phase 2 plan says.
- A new help page, **Signing**, plus updates to Details, Saving, Cleaning up and Command line, and the README.
- The fixture script makes a test certificate file with a test password, so the manual script needs nothing of yours. The manual script is `docs/manual-tests/2e-sign.md`, about 30 minutes, and covers:
  - signing visibly and invisibly, and in an existing box;
  - signing twice;
  - a file changed after signing;
  - trusting a certificate;
  - the warning on saving a signed file;
  - `scribeforge verify`.

---

## 12. Questions for you

1. **Packages.** Use pkijs 3.4.3 and asn1js 3.0.10, with their five small helpers, instead of node-forge and @signpdf?
   _I recommend yes (S1 to S3)._
2. **Certificates.** Certificate files (`.pfx`, `.p12`) only in this stop, with Windows' store and smart cards as a later plan?
   _I recommend yes. Those need a native part._
3. **Making your own certificate.** Add "Make a certificate…", which saves a certificate in your name as a password-protected `.pfx`?
   _I recommend yes. Without it, you can't sign anything unless you buy a certificate. (The manual script uses a test certificate either way.)_
4. **The look.** A box you draw on the page by default, with an existing signature box or invisible as the other choices? The box shows name, date and reason, with no handwritten-signature picture for now.
   _I recommend yes._
5. **The kind of signature.** PAdES with SHA-256 (`ETSI.CAdES.detached`), the current standard? ScribeForge checks the older kind too.
   _I recommend yes._
6. **Trust.** Trust Windows' top-level certificates on this PC, plus certificates you choose, kept in settings?
   _I recommend yes._
7. **Signed files and other tools.** New files leave out signatures and their look completely, after a warning?
   _I recommend yes. A box that looks like a signature, but isn't one, misleads._
8. **The command line.** Add `scribeforge verify` now, and signing from the command line later?
   _I recommend yes._
9. **Remembering the certificate file.** Remember where your certificate file is (its location only, never the password), and forget it when the recent-files list is cleared or turned off?
   _I recommend yes._
10. **What waits.** Everything in section 10 waits for later.
    _I recommend yes._

~~Answer by number, or say "go" to accept every recommendation.~~ Approved 2026-10-22, with every recommendation accepted.
