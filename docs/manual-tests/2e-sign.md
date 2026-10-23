# Manual test: stop 2e, signing

About 30 minutes. Everything runs in **trial mode**, with made-up test PDFs and a made-up test certificate. You'll save a few new files, so first make a folder for them, for example `Desktop\ScribeForge 2e test`. Delete it when you're done.

The test certificate file is `tests\fixtures\out\test-signer.pfx`, in the name of "Alex Example". Its password is **open the test key**.

Each step says what to do, then **what you should see**. If something doesn't match, note the step number and what you saw.

## Setup

A. Make the test PDFs and the test certificate:
```bash
npm run fixtures
```
B. Start from clean trial data:
```bash
npm run trial:reset
```
C. Start trial mode:
```bash
npm run trial
```

## Checking signatures

1. Open `tests\fixtures\out\signed.pdf`. **Under the toolbar: "This file has 1 signature: valid, identity not confirmed. See the signatures".** Scroll to the bottom of page 1. **A box with a thin border: "Signed by Alex Example", today's date and time, "Reason: Approved for testing", "Place: Test desk".** On the left there's a new item, **Sign**, with a seal.
2. Click **See the signatures**. **The Sign screen. The signature says "Valid. The file hasn't changed since Alex Example signed it.", who signed and when, the reason and place, "Its box is on page 1.", "Certificate: Alex Example, issued by ScribeForge Test Root." and "Identity not confirmed. Anyone can make a certificate with any name."** In grey: **"Not checked: whether the certificate was cancelled. That needs the internet." and "The signing time comes from the signer's computer clock."**
3. Click **Details**. **In "What this file carries", a Signatures row: "1 signature", with "Signature1" and a note that the Sign screen checks it. Form fields: None.**
4. Back on **Sign**, click **Trust this certificate…**. **A question, "Trust this certificate?", explaining when to trust it and showing its fingerprint.** Click **Trust it**. **The signature now says "You chose to trust this certificate.", and "Certificates you trust" lists Alex Example with its fingerprint.** Click **Document**. **The line under the toolbar now ends "It's valid."** Go back to **Sign**.
5. Click **Remove** next to Alex Example. **Back to "Identity not confirmed", and the list says "None yet."**
6. Open `tests\fixtures\out\signed-twice.pdf` and click **Sign**. **Two signatures. The first (Alex Example) says "Valid. Only other signatures were added after it." The second (Sam Example, reason "Second signature") says "Certificate: Sam Example, which issued itself." and "It has no box on the page."**
7. Open `tests\fixtures\out\signed-changed.pdf`. **Page 1 has an extra line near the middle: "PAY 1,000,000 TO MALLORY". The line under the toolbar says "changed after signing".** Click **Sign**. **"Changed after signing. Alex Example signed an earlier version. Open the signed version to see what they signed."**
8. Click **Open the signed version**. **A file called "signed-changed (as signed by Alex Example).pdf" opens. The MALLORY line isn't there, and its signature is valid.** Press `Ctrl+F` and search for `MALLORY`. **Not found.**

## Signing

9. Open `tests\fixtures\out\normal.pdf`, click **Sign**, then **Sign this file…**. **"Sign this file", with "No certificate file chosen."** Click **Choose a certificate file…** and choose `tests\fixtures\out\test-signer.pfx`.
10. Type `wrong` as the password and click **Next**. **"That password didn't work. Try again."** Type **open the test key** and click **Next**. **"Signed by Alex Example", "Issued by ScribeForge Test Root", and when it's valid. "How it looks" has "A box I draw on the page…" chosen; the empty-box choice is greyed out ("this file hasn't any").**
11. Type `Approved in the manual test` as the reason and click **Draw the box…**. **The Document screen, with "Drag a box on the page where the signature should go…" and a Cancel signing button.** Drag a box in the empty space on page 1. **A dashed outline follows the mouse.**
12. **A save window opens, suggesting "normal (signed).pdf".** Save it in your test folder. **"Signed and saved normal (signed).pdf.", the new file opens, the line under the toolbar says "valid, identity not confirmed", and your box shows on page 1 with the name, date and reason.**
13. Sign this new file again: **Sign**, **Sign this file…**. **The certificate file is already chosen (test-signer.pfx).** Type the password, click **Next**, choose **Invisible**, and click **Sign and save…**. Save it in your test folder. **The new file has two signatures. The first says "Only other signatures were added after it."**
14. Open `tests\fixtures\out\sign-here.pdf`. **Page 1 says "Sign here:" above an empty box.** Sign it: **Sign this file…**, password, **Next**, then choose **In an empty signature box this file has**. **"Approver, page 1" is chosen.** Click **Sign and save…** and save it in your test folder. **The box now shows the signature, and the Sign screen shows it as valid, with its box on page 1.**

## Unsaved changes, and saving a signed file

15. Open `tests\fixtures\out\normal.pdf`. On **Pages**, turn page 2 once with **Rotate right**. Click **Sign**. **A note: "Your changes aren't saved yet, so ScribeForge makes the new file first, as Save does, and signs that."** Sign it invisibly and save it in your test folder. **It opens with page 2 turned, and its signature is valid.**
16. Open `tests\fixtures\out\signed.pdf` and press `Ctrl+S`. **"The new file won't be signed": signed.pdf is signed, and its signature is left out, with its box.** Click **Save without the signatures**. **The summary says "1 signature was left out, with its box".** Save it in your test folder. **The new file has no line under the toolbar about signatures, and page 1 has no signature box.**
17. Open `tests\fixtures\out\signed.pdf` again and click **Clean up**. **A "Signatures" section: "1 signature." and "A new file never keeps a signature or its box…".**

## Your own certificate

18. Click **Sign**, then **Make a certificate…**. Type your name, leave the email empty, and type a password of at least 8 characters twice. Click **Make and save…** and save it in your test folder. **"Saved your certificate as <your name>.pfx. Keep it safe, and remember its password…"**
19. Click **Sign this file…**. **Your new certificate file is already chosen.** Type its password and click **Next**. **"Issued by: Itself", and a note that other people's readers will say its identity isn't confirmed unless they trust it.** Click **Cancel**.
20. Click **Settings** and clear the recent files. Back on **Sign**, click **Sign this file…**. **"No certificate file chosen."**: ScribeForge forgot where it was. Click **Cancel**.

## Other readers (optional)

21. Open your file from step 12 in **Microsoft Edge**. **The signature box shows on page 1.** (Edge shows signatures but doesn't check them.)
22. If you have **Adobe Acrobat Reader** (free from Adobe), open the same file there and open its signature panel. **It should say the document hasn't been changed since it was signed, and that the signer's identity is unknown.** _Needs verification: Adobe isn't on the PC ScribeForge was built on._

## The command line

23. Close ScribeForge. In a Command Prompt in the ScribeForge folder, build the app once, then check a signed file:
```bash
npm run build
```
```bash
npx electron . verify tests\fixtures\out\signed.pdf
```
**"This file has 1 signature: valid, identity not confirmed." and the same lines as the Sign screen.** Type `echo %ERRORLEVEL%`. **3.**
24. Now trust the test root:
```bash
npx electron . verify tests\fixtures\out\signed.pdf --trust tests\fixtures\out\test-root.cer
```
**"This file has 1 signature. It's valid."** and `echo %ERRORLEVEL%` gives **0.**

## Finish

25. Delete your test folder.
