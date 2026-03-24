# User Stories

## Story 1: Splash Screen on Boot ✅

> *As a user, when I power on the device, I see a splash screen on the e-ink display showing the project name, so I know the hardware and display are working.*

**Acceptance criteria:**
- [x] Device boots and renders text to the e-ink display
- [x] Shows "E-Ink Reader" centered on screen
- [x] Display persists (e-ink holds image with no power)
- [x] No button interaction needed

## Story 2: Multi-Mode Button Input ✅

> *As a user, I can interact with the device using a single button that supports multiple press types, so that one button can control different functions.*

**Acceptance criteria:**
- [x] Single press — detected and displayed
- [x] Double press — detected and displayed
- [x] Long press (hold ~1.5s) — detected and displayed
- [x] Button is GPIO0 with debounce handling
- [x] Press types are mutually exclusive (a long press doesn't also trigger a single press)

## Story 3: Deep Sleep & Wake on Button Press ✅

> *As a user, the device enters deep sleep after 30 seconds of inactivity and wakes instantly when I press the button, so battery life is maximized.*

**Acceptance criteria:**
- [x] Device enters deep sleep after 30 seconds with no button press
- [x] Display shows "Sleeping..." message before sleep
- [x] Wake on GPIO0 button press
- [x] After wake, device boots and shows the splash screen
- [x] Button presses reset the inactivity timer
- [x] E-ink display retains its content during sleep

## Story 4: Content Pre-processor ✅

> *As a content preparer, I can process a `.txt` file into `book.txt` and `book.idx` files formatted for the device's display constraints.*

**Acceptance criteria:**
- [x] Word-wraps to 18 characters per line (monospace)
- [x] Paginates to 6 lines per page
- [x] Outputs `book.txt` — the wrapped text with newlines
- [x] Outputs `book.idx` — binary file of uint32 little-endian byte offsets, one per page start
- [x] Handles word boundaries (no mid-word breaks unless word exceeds line width)
- [x] Breaks words longer than line width
- [x] Preserves existing newlines
- [x] Handles empty input gracefully
- [x] No trailing whitespace on wrapped lines
- [x] All logic covered by unit tests (13 passing)

## Story 5: Web Upload & Preview UI ✅

> *As a content preparer, I can use a web page to upload a `.txt` file, preview the paginated output, and download `book.txt` + `book.idx` as a zip.*

**Acceptance criteria:**
- [x] GET / serves an HTML upload page
- [x] POST /process accepts a .txt file and returns paginated JSON preview
- [x] POST /download accepts a .txt file and returns book.zip (book.txt + book.idx)
- [x] Rejects non-.txt files with 400 status
- [x] Returns 400 when no file uploaded
- [x] All routes covered by integration tests (18 total passing)

## Story 6: Read and Display Pages from LittleFS ✅

> *As a user, when I press the button, the device reads the next page from the book stored in LittleFS and displays it on the e-ink screen, so I can read through a book page by page.*

**Acceptance criteria:**
- [x] On boot, mounts LittleFS and loads `book.idx`
- [x] Reads current page number from NVS (starts at 0 if none saved)
- [x] Displays the current page text on the e-ink screen
- [x] Single press advances to the next page and saves position to NVS
- [x] Double press goes back to the previous page
- [x] Shows a progress bar at the bottom (% through book)
- [x] Displays "End of book" when reaching the last page
- [x] Handles missing `book.txt`/`book.idx` gracefully (shows error message)

**Known issues:**
- Font is too small (using default GFX font, need OpenDyslexic Mono)
- Odd characters from Unicode in source text (curly quotes, em dashes, etc.)

## Story 7: OpenDyslexic Mono Font & Display Layout 🔧

> *As a user, the text on screen is rendered in a large, readable OpenDyslexic Mono font with proper layout, so it's comfortable to read for someone with dyslexia.*

**Acceptance criteria:**
- [ ] OpenDyslexic Mono bitmap font baked into firmware
- [ ] ~15-20 characters per line, ~5-7 lines per page (per design doc)
- [ ] Text fills the screen with minimal chrome
- [ ] Pre-processor strips/replaces non-ASCII characters (curly quotes, em dashes, etc.)
- [ ] Pre-processor line width and page size match firmware font metrics
- [ ] Unit tests for character sanitization

## Story 8: Book Start Offset ✅

> *As a content preparer, I can specify where the actual story begins in the text file, so the reader skips introductory metadata (title pages, copyright, archive headers, etc.)*

**Acceptance criteria:**
- [x] Web UI preview lets user set which page the book starts on
- [x] Skipped pages shown dimmed in preview
- [x] Output book.txt and book.idx only contain content from the start point forward
- [x] Returns 400 when startPage exceeds total pages
- [x] Covered by integration tests (29 total passing)

## Story 9: Page Number Display ✅

> *As a user, I can see the current page number and total pages in small print on the screen, so I know my reading progress.*

**Acceptance criteria:**
- [x] Shows "page/total" (e.g. "1/8103") in small text at bottom right
- [x] Doesn't interfere with reading content
- [x] Positioned just above the progress bar
