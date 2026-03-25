#include <heltec-eink-modules.h>
#include <LittleFS.h>
#include <Preferences.h>
#include "fonts/OpenDyslexic8pt7b.h"

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
static const uint8_t LINES_PER_PAGE = 5;
static const uint16_t SCREEN_WIDTH = 250;
static const uint16_t SCREEN_HEIGHT = 122;
static const uint8_t PROGRESS_BAR_HEIGHT = 2;
static const uint8_t LINE_HEIGHT = 22;
static const uint8_t TOP_MARGIN = 14;

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

// --- App Mode ---
enum class AppMode { READING, MENU, JUMP_TO_PAGE };
static AppMode appMode = AppMode::READING;

// --- Menu State ---
enum class MenuItem { PAGE_INFO, JUMP_TO_PAGE, SLEEP_NOW, COUNT };
static uint8_t menuIndex = 0;
static const char* menuLabels[] = { "Page Info", "Jump to Page", "Sleep Now" };

// --- Jump to Page State ---
static uint8_t jumpDigits[5] = {0, 0, 0, 0, 0};  // Up to 99999
static uint8_t jumpDigitIndex = 0;
static uint8_t jumpNumDigits = 1;  // How many digits needed for totalPages

// --- Press Types ---
enum class PressType { NONE, SINGLE, DOUBLE, LONG };

// --- Forward Declarations ---
bool loadBookIndex();
void displayPage();
void showMenu();
void showJumpToPage();

void showMessage(const char* msg) {
    display.clearMemory();
    display.landscape();
    display.setFont(&OpenDyslexic_Regular8pt7b);
    display.setTextSize(1);
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

// --- Menu Display ---

void showMenu() {
    display.clearMemory();
    display.landscape();
    display.setFont(&OpenDyslexic_Regular8pt7b);
    display.setTextSize(1);

    // Title
    display.setCursor(2, TOP_MARGIN);
    display.print("-- Menu --");

    // Menu items
    uint8_t count = (uint8_t)MenuItem::COUNT;
    for (uint8_t i = 0; i < count; i++) {
        display.setCursor(10, TOP_MARGIN + (i + 1) * LINE_HEIGHT);
        if (i == menuIndex) {
            display.print("> ");
        } else {
            display.print("  ");
        }
        display.print(menuLabels[i]);
    }

    // Hint at bottom
    display.setFont(NULL);
    display.setCursor(2, SCREEN_HEIGHT - 10);
    display.print("1x:next  2x:select  hold:exit");

    display.update();
}

void showPageInfo() {
    char info[64];
    snprintf(info, sizeof(info), "Page %lu / %lu",
             (unsigned long)(currentPage + 1),
             (unsigned long)totalPages);
    showMessage(info);
    delay(2000);
    showMenu();
}

// --- Jump to Page ---

void initJumpToPage() {
    // Calculate how many digits we need
    uint32_t tp = totalPages;
    jumpNumDigits = 0;
    while (tp > 0) {
        jumpNumDigits++;
        tp /= 10;
    }
    if (jumpNumDigits == 0) jumpNumDigits = 1;
    if (jumpNumDigits > 5) jumpNumDigits = 5;

    // Initialize all digits to 0
    for (uint8_t i = 0; i < 5; i++) jumpDigits[i] = 0;
    jumpDigitIndex = 0;
    appMode = AppMode::JUMP_TO_PAGE;
    showJumpToPage();
}

void showJumpToPage() {
    display.clearMemory();
    display.landscape();
    display.setFont(&OpenDyslexic_Regular8pt7b);
    display.setTextSize(1);

    display.setCursor(2, TOP_MARGIN);
    display.print("Jump to page:");

    // Draw the digit entry — use default font for larger, clearer digits
    display.setFont(NULL);
    display.setTextSize(3);  // Big digits

    // Calculate total width for centering
    uint16_t digitWidth = 18 * jumpNumDigits + 6 * (jumpNumDigits - 1);  // 18px per digit + 6px gaps
    int16_t startX = (SCREEN_WIDTH - digitWidth) / 2;
    int16_t digitY = 45;

    for (uint8_t i = 0; i < jumpNumDigits; i++) {
        int16_t x = startX + i * 24;
        display.setCursor(x, digitY);
        display.print(jumpDigits[i]);

        // Underline the active digit
        if (i == jumpDigitIndex) {
            display.fillRect(x, digitY + 25, 18, 3, BLACK);
        }
    }

    // Show max page hint
    display.setTextSize(1);
    char hint[32];
    snprintf(hint, sizeof(hint), "max: %lu", (unsigned long)totalPages);
    display.setCursor(2, SCREEN_HEIGHT - 10);
    display.print(hint);

    // Show controls hint on right
    display.setCursor(120, SCREEN_HEIGHT - 10);
    display.print("1x:+1  2x:ok  hold:cancel");

    display.update();
}

uint32_t getJumpPageNumber() {
    uint32_t page = 0;
    for (uint8_t i = 0; i < jumpNumDigits; i++) {
        page = page * 10 + jumpDigits[i];
    }
    return page;
}

// --- Book Loading & Display ---

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

    if (pageLen > 512) pageLen = 512;

    char buf[513];
    bookFile.seek(startOffset);
    size_t bytesRead = bookFile.read((uint8_t*)buf, pageLen);
    bookFile.close();
    buf[bytesRead] = '\0';

    // Render page
    display.clearMemory();
    display.landscape();
    display.setFont(&OpenDyslexic_Regular8pt7b);
    display.setTextSize(1);

    char* line = buf;
    uint8_t lineNum = 0;
    for (char* p = buf; *p && lineNum < LINES_PER_PAGE; p++) {
        if (*p == '\n') {
            *p = '\0';
            display.setCursor(2, TOP_MARGIN + lineNum * LINE_HEIGHT);
            display.print(line);
            line = p + 1;
            lineNum++;
        }
    }
    if (*line && lineNum < LINES_PER_PAGE) {
        display.setCursor(2, TOP_MARGIN + lineNum * LINE_HEIGHT);
        display.print(line);
    }

    // Page number
    display.setFont(NULL);
    display.setTextSize(1);
    char pageNum[16];
    snprintf(pageNum, sizeof(pageNum), "%lu/%lu",
             (unsigned long)(currentPage + 1), (unsigned long)totalPages);
    int16_t pnWidth = strlen(pageNum) * 6;
    display.setCursor(SCREEN_WIDTH - pnWidth - 2,
                      SCREEN_HEIGHT - PROGRESS_BAR_HEIGHT - 9);
    display.print(pageNum);

    // Progress bar
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

// --- Mode Handlers ---

void handleReading(PressType press) {
    switch (press) {
        case PressType::SINGLE:
            if (currentPage + 1 < totalPages) {
                currentPage++;
                savePage();
                displayPage();
            } else {
                showMessage("End of book");
            }
            break;

        case PressType::DOUBLE:
            if (currentPage > 0) {
                currentPage--;
                savePage();
                displayPage();
            }
            break;

        case PressType::LONG:
            appMode = AppMode::MENU;
            menuIndex = 0;
            showMenu();
            break;

        default:
            break;
    }
}

void handleMenu(PressType press) {
    switch (press) {
        case PressType::SINGLE:
            // Cycle through menu items
            menuIndex = (menuIndex + 1) % (uint8_t)MenuItem::COUNT;
            showMenu();
            break;

        case PressType::DOUBLE:
            // Select current item
            switch ((MenuItem)menuIndex) {
                case MenuItem::PAGE_INFO:
                    showPageInfo();
                    break;
                case MenuItem::JUMP_TO_PAGE:
                    initJumpToPage();
                    break;
                case MenuItem::SLEEP_NOW:
                    appMode = AppMode::READING;
                    enterDeepSleep();
                    break;
                default:
                    break;
            }
            break;

        case PressType::LONG:
            // Exit menu
            appMode = AppMode::READING;
            displayPage();
            break;

        default:
            break;
    }
}

void handleJumpToPage(PressType press) {
    switch (press) {
        case PressType::SINGLE:
            // Cycle current digit 0-9
            jumpDigits[jumpDigitIndex] = (jumpDigits[jumpDigitIndex] + 1) % 10;
            showJumpToPage();
            break;

        case PressType::DOUBLE:
            // Confirm current digit, move to next
            jumpDigitIndex++;
            if (jumpDigitIndex >= jumpNumDigits) {
                // All digits entered — perform jump
                uint32_t targetPage = getJumpPageNumber();
                if (targetPage < 1) targetPage = 1;
                if (targetPage > totalPages) targetPage = totalPages;
                currentPage = targetPage - 1;  // 0-indexed
                savePage();
                appMode = AppMode::READING;
                displayPage();
            } else {
                showJumpToPage();
            }
            break;

        case PressType::LONG:
            // Cancel — back to menu
            appMode = AppMode::MENU;
            showMenu();
            break;

        default:
            break;
    }
}

// --- Setup & Loop ---

void setup() {
    pinMode(BUTTON_PIN, INPUT_PULLUP);
    lastActivityMs = millis();

    prefs.begin("reader", false);
    currentPage = prefs.getUInt("page", 0);

    if (!LittleFS.begin(true)) {
        showError("LittleFS", "mount failed");
        return;
    }

    bookLoaded = loadBookIndex();
    if (!bookLoaded) {
        showError("No book found.", "Upload via web UI");
        return;
    }

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

    switch (appMode) {
        case AppMode::READING:
            handleReading(press);
            break;
        case AppMode::MENU:
            handleMenu(press);
            break;
        case AppMode::JUMP_TO_PAGE:
            handleJumpToPage(press);
            break;
    }

    // Only sleep from reading mode
    if (appMode == AppMode::READING && (millis() - lastActivityMs) >= SLEEP_TIMEOUT_MS) {
        enterDeepSleep();
    }
}
