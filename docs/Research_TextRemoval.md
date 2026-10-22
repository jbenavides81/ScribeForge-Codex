# Research: removing only what's under a redaction mark

Stop 2c, Phase 2 plan question 10. Written 2026-10-22.

## The question

Today, every page with a redaction mark becomes a picture of itself with the marks blacked out. That's safe, but the whole page loses its text: nothing on it can be selected, searched or read aloud, and the file grows by roughly half a megabyte per redacted page at 200 dpi.

The question was whether ScribeForge could instead remove just the marked letters, pictures and drawings from the page's own drawing instructions, keeping the rest of the page as real text.

## The short answer

**Yes, for most ordinary pages, with a safe fallback for the rest.** A prototype removed marked text from every kind of text it was tested on. The secret was then found nowhere in the file, the rest of the page stayed real text, and nothing outside the marks changed by a single pixel. It also blacked out the marked part of pictures stored the common lossless way, and removed drawings lying wholly inside a mark.

What it can't yet handle, it says so, and those pages would stay pictures, as today. Two risks need a decision before this is built (see "What it can't do yet"). The main one is that a font kept for the rest of the page can still show which letters the removed text used.

**My recommendation:** build it as its own stop, as an option ("Keep the page's other text") that's off by default. It would work page by page: any page with something it can't handle under a mark becomes a picture, as today, and the summary says which pages. The same last check runs either way. Pictures stay the default.

## How the prototype works

The prototype is in `research/text-removal/`, and its experiments are in `tests/unit/research-text-removal.test.ts`. It isn't part of the app, and nothing in the app uses it.

1. **It reads the page's drawing instructions.** Text, numbers, names, arrays, dictionaries and pictures stored in the page itself are all handled, building on the reader from the Phase 2 plan's experiment F6.
2. **It follows every letter.** For each piece of text, it tracks where the next letter goes and how big it is, as a PDF reader does. That includes the size and position of the text, letter spacing, word spacing, horizontal stretching, line moves, raised text, and turned or skewed text (ISO 32000-1, 9.4.4).
3. **It works out each letter's width from the font itself.**
    - For a font that lists its own widths, it uses that list.
    - For the 14 standard fonts, which needn't list widths, it uses the PDF library's own measurements.
    - For Type 3 fonts, it uses their widths and their own scale.
    - For two-byte fonts (Type 0, Identity-H), it uses their width list. This last one is untested; see below.
4. **It takes out the letters under a mark.** Each one becomes a spacing number of exactly the same width, so every other letter stays where it was, to the pixel.
5. **It handles shared drawings.** A drawing reused on several pages (a form XObject, such as a letterhead) is copied for the marked page before it's changed, so other pages keep theirs.
6. **It handles pictures under a mark.** One stored uncompressed or with Flate (8 bits, grey or colour) has the marked part of the picture itself set to black, so the hidden pixels are gone, not just covered.
7. **It handles drawings under a mark.** A drawing wholly inside a mark is removed.
8. **It removes text kept for screen readers.** A tagged section's ActualText or Alt (text kept for screen readers) is removed when letters inside it are.
9. **It draws the black boxes.** Then whatever is left unused, such as the page's old drawing instructions, is swept out of the file. The app's engine already does this before saving.

Anything else under a mark is reported, not guessed at.

## Results

Each experiment makes a page with something secret, marks it, runs the prototype, and checks four things:

1. the secret is found nowhere in the file, in any form: plain, hex, UTF-16 or compressed (the Phase 1 check);
2. the words around it are still real text;
3. nothing outside the mark looks any different: 0 pixels changed, allowing 2 points around each mark for smoothed edges;
4. the mark is solid black.

| Case | Result |
|---|---|
| Text in a sentence | **Passes** all four checks |
| Text split into pieces and kerned (TJ) | **Passes** |
| Letter spacing, word spacing and stretched text | **Passes** |
| Invisible text (as in scanned documents) | **Passes** |
| Text on a hidden layer | **Passes** |
| Text with ActualText for screen readers | **Passes**: the ActualText goes too |
| Text turned sideways | **Passes** |
| A font that lists its own widths | **Passes** |
| A standard font with no width list | **Passes** (every case above uses one) |
| Text in a drawing shared by two pages | **Passes**: only the marked page changes; the other page keeps its text |
| A Type 3 font (letters drawn by small drawings of their own) | **Passes** |
| A picture stored with Flate | **Passes**: the picture's own pixels under the mark are black; the rest are untouched |
| A JPEG picture | **Reported**: the page would stay a picture |
| A drawing wholly inside a mark | **Passes**: removed |
| A drawing crossing a mark's edge | **Reported** |
| Page size | A 30-line page grew by under 8 KB. As a picture at 200 dpi, a redacted page is typically 300 to 600 KB. |

## What it can't do yet

**Reported, so the page would stay a picture:**
- **JPEG pictures.** These need decoding and re-encoding. pdf.js can decode them; saving the result losslessly makes it larger, and saving it as JPEG again loses a little quality. This is the most common case in scanned documents, so it matters most.
- **Pictures stored with a predictor, in other colour formats, or stored in the page itself (inline images).**
- **Drawings that cross a mark's edge.** These would need the drawing cut at the mark. Covering it isn't enough, since the hidden part would still be in the file.
- **Shadings (colour blends),** which can run under a mark.
- **Fonts with other encodings or vertical writing,** and fonts with no widths that aren't one of the standard 14.

**Not tested yet:**
- **Two-byte (Type 0) fonts,** which most files from Word use for anything beyond basic Latin. The code reads their width lists, but making a test file needs a font-embedding package ScribeForge doesn't have. Real files from Word, LibreOffice and Chrome need testing before this is trusted.
- **Text inside tiling patterns, soft masks and transparency groups,** and text used as a clipping path.

**Risks to decide on:**
- **Fonts can reveal which letters were used.** When a font is kept for the rest of the page, its embedded letter shapes stay. If a letter appears only in the removed text, a determined reader could see that it was used, though not where or in what order. Pictures don't have this problem, because a redacted page's fonts go entirely. The fix is to rebuild each font with only the letters still in use, which is a substantial piece of work. **Recommendation:** rebuild the fonts. Until that exists, keep the option off by default and say this plainly beside it.
- **The width of the removed text stays in the file.** The spacing number left behind gives the exact width of what was removed. A black box shows roughly the same width anyway, but the number is exact. Published research has shown that such widths can narrow down short words such as names (Bland and others, "Story Beyond the Eye: Glyph Positions Break PDF Text Redaction", PETS 2023). **Recommendation:** round the spacing to the box's width, and make the black box cover whole words.
- **Text kept elsewhere in the file.** A document's structure tree can also keep alternative text outside the page. ScribeForge's redacted files don't carry the structure tree, as today, so this stays covered.
- **Partly covered letters.** A letter only partly under a mark is removed whole, and a letter's ink can reach slightly beyond its width (italics). This is the safe direction, and the black box should cover whole letters.

## What building it would take

As its own stop, after your go-ahead:

1. Move the reader and the removal into the engine, running in its worker like the rest.
2. Decode and black out JPEG pictures (saved losslessly, with the size shown), and cut drawings at a mark's edge. Or keep both as fallbacks for a first version.
3. Rebuild kept fonts with only the letters still in use. This is the largest piece, and needs a font-subsetting package, which would need your approval.
4. Test with real files from Word, LibreOffice, Chrome's "Save as PDF" and scanners. Every one must pass the same four checks, or fall back to a picture.
5. Add the option to the redaction summary, with plain notes on which pages kept their text and which became pictures.

Pictures stay the default either way.
