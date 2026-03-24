#include <heltec-eink-modules.h>
#include <LittleFS.h>
#include <Preferences.h>

EInkDisplay_WirelessPaperV1_2 display;
Preferences prefs;

// --- Button Configuration ---
static const uint8_t BUTTON_PIN = 0;  // GPIO0 — user button
static const unsigned long DEBOUNCE_MS = 50;
static const unsigned long LONG_PRESS_MS = 1500;
static const unsigned long DOUBLE_PRESS_WINDOW_MS = 300;

// --- Sleep Configuration ---
static const unsigned long SLEEP_TIMEOUT_MS = 30000;  // 30 seconds

// --- Display Layout ---
static const uint8_t LINES_PER_PAGE = 6;
static const uint16_t SCREEN_WIDTH = 250;
static const uint16_t SCREEN_HEIGHT = 122;
static const uint8_t PROGRESS_BAR_HEIGHT = 2;

// --- Button State ---
static bool lastButtonState = HIGH;
static bool buttonDown = false;
static unsigned long pressStartMs = 0;
static unsigned long lastReleaseMs = 0;
static uint8_t pressCount = 0;
static bool longPressHandled = false;

// --- Activity Tracking ---
static unsigned long lastActivityMs = 0;

// --- Book State ---
static uint32_t currentPage = 0;
static uint32_t totalPages = 0;
static uint32_t* pageOffsets = nullptr;
static uint32_t bookFileSize = 0;
static bool bookLoaded = false;

// --- Press Types ---
enum class PressType { NONE, SINGLE, DOUBLE, LONG };

void showMessage(const char* msg) {
    display.clearMemory();
    display.landscape();
    display.setTextSize(2);
    display.printCenter(msg);
    display.update();
}

void showError(const char* line1, const char* line2 = nullptr) {
    display.clearMemory();
    display.landscape();
    display.setTextSize(1);
    display.setCursor(5, 30);
    display.print(line1);
    if (line2) {
        display.setCursor(5, 50);
        display.print(line2);
    }
    display.update();
}

bool loadBookIndex() {
    File idxFile = LittleFS.open("/book.idx", "r");
    if (!idxFile) return false;

    size_t idxSize = idxFile.size();
    totalPages = idxSize / 4;
    if (totalPages == 0) {
        idxFile.close();
        return false;
    }

    pageOffsets = (uint32_t*)malloc(idxSize);
    if (!pageOffsets) {
        idxFile.close();
        return false;
    }

    idxFile.read((uint8_t*)pageOffsets, idxSize);
    idxFile.close();

    // Get book.txt file size for bounds checking
    File bookFile = LittleFS.open("/book.txt", "r");
    if (!bookFile) {
        free(pageOffsets);
        pageOffsets = nullptr;
        return false;
    }
    bookFileSize = bookFile.size();
    bookFile.close();

    return true;
}

void displayPage() {
    if (!bookLoaded || totalPages == 0) {
        showError("No book loaded");
        return;
    }

    if (currentPage >= totalPages) {
        currentPage = totalPages - 1;
    }

    // Read page text from book.txt
    File bookFile = LittleFS.open("/book.txt", "r");
    if (!bookFile) {
        showError("Cannot open", "book.txt");
        return;
    }

    uint32_t startOffset = pageOffsets[currentPage];
    uint32_t endOffset = (currentPage + 1 < totalPages)
        ? pageOffsets[currentPage + 1]
        : bookFileSize;
    uint32_t pageLen = endOffset - startOffset;

    // Cap read size to a reasonable buffer
    if (pageLen > 512) pageLen = 512;

    char buf[513];
    bookFile.seek(startOffset);
    size_t bytesRead = bookFile.read((uint8_t*)buf, pageLen);
    bookFile.close();
    buf[bytesRead] = '\0';

    // Render page
    display.clearMemory();
    display.landscape();
    display.setTextSize(1);
    display.setCursor(0, 8);
    display.print(buf);

    // Progress bar at bottom
    float progress = (float)(currentPage + 1) / (float)totalPages;
    uint16_t barWidth = (uint16_t)(progress * SCREEN_WIDTH);
    display.fillRect(0, SCREEN_HEIGHT - PROGRESS_BAR_HEIGHT,
                     barWidth, PROGRESS_BAR_HEIGHT, BLACK);

    display.update();
}

void savePage() {
    prefs.putUInt("page", currentPage);
}

void enterDeepSleep() {
    showMessage("Sleeping...");
    delay(1000);

    esp_sleep_enable_ext0_wakeup((gpio_num_t)BUTTON_PIN, 0);
    esp_deep_sleep_start();
}

PressType readButton() {
    bool reading = digitalRead(BUTTON_PIN);
    unsigned long now = millis();
    PressType result = PressType::NONE;

    static unsigned long lastTransitionMs = 0;
    if (reading != lastButtonState) {
        lastTransitionMs = now;
    }
    if ((now - lastTransitionMs) < DEBOUNCE_MS) {
        lastButtonState = reading;
        return PressType::NONE;
    }

    if (reading == LOW && !buttonDown) {
        buttonDown = true;
        pressStartMs = now;
        longPressHandled = false;
    }

    if (buttonDown && reading == LOW && !longPressHandled) {
        if ((now - pressStartMs) >= LONG_PRESS_MS) {
            longPressHandled = true;
            pressCount = 0;
            result = PressType::LONG;
        }
    }

    if (reading == HIGH && buttonDown) {
        buttonDown = false;
        if (!longPressHandled) {
            pressCount++;
            lastReleaseMs = now;
        }
    }

    if (pressCount > 0 && !buttonDown && (now - lastReleaseMs) >= DOUBLE_PRESS_WINDOW_MS) {
        if (pressCount >= 2) {
            result = PressType::DOUBLE;
        } else {
            result = PressType::SINGLE;
        }
        pressCount = 0;
    }

    lastButtonState = reading;
    return result;
}

void setup() {
    pinMode(BUTTON_PIN, INPUT_PULLUP);
    lastActivityMs = millis();

    // Initialize NVS for page persistence
    prefs.begin("reader", false);
    currentPage = prefs.getUInt("page", 0);

    // Mount LittleFS and load book
    if (!LittleFS.begin(true)) {
        showError("LittleFS", "mount failed");
        return;
    }

    bookLoaded = loadBookIndex();
    if (!bookLoaded) {
        showError("No book found.", "Upload book.txt + book.idx");
        return;
    }

    // Clamp page to valid range
    if (currentPage >= totalPages) {
        currentPage = 0;
    }

    displayPage();
}

void loop() {
    PressType press = readButton();

    if (press != PressType::NONE) {
        lastActivityMs = millis();
    }

    switch (press) {
        case PressType::SINGLE:
            // Next page
            if (currentPage + 1 < totalPages) {
                currentPage++;
                savePage();
                displayPage();
            } else {
                showMessage("End of book");
            }
            break;

        case PressType::DOUBLE:
            // Previous page
            if (currentPage > 0) {
                currentPage--;
                savePage();
                displayPage();
            }
            break;

        case PressType::LONG:
            // Future: sync mode. For now, just show page info.
            {
                char info[64];
                snprintf(info, sizeof(info), "Page %lu / %lu",
                         (unsigned long)(currentPage + 1),
                         (unsigned long)totalPages);
                showMessage(info);
            }
            break;

        default:
            break;
    }

    if ((millis() - lastActivityMs) >= SLEEP_TIMEOUT_MS) {
        enterDeepSleep();
    }
}
