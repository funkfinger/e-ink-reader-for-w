# E-Ink Reader for Dylan — Design Document

## Overview

A tiny, battery-powered e-ink reader built on the Heltec Wireless Paper (ESP32-S3) module. Designed for a 15-year-old with dyslexia and ADHD — prioritizing large text, short line lengths, minimal distractions, and dead-simple interaction.

## Hardware

- **Board:** Heltec Wireless Paper (ESP32-S3, 2.13" e-ink display, 250x122 pixels)
- **Battery:** LiPo, sized to match the board's X/Y footprint. Onboard USB-C charging.
- **Enclosure:** 3D-printed case with access to the single user button (GPIO0)
- **Input:** Single button — short press = next page, long press = menu/sync

## Display & Typography

- **Font:** OpenDyslexic Mono (monospace, bitmap, baked into firmware)
- **Layout:** ~15-20 characters per line, ~5-7 lines per page
- **Progress:** Thin 1-2 pixel progress bar at the bottom of the screen (% complete)
- **Battery:** Small battery icon, only shown when voltage drops below ~3.3V
- **Philosophy:** Minimal chrome. The screen is almost entirely reading content.

## Content Pipeline

### Pre-processor (Node.js CLI)

A Node.js CLI tool handles all text processing off-device:

1. Takes a `.txt` file as input
2. Word-wraps using OpenDyslexic Mono metrics (fixed character width)
3. Calculates page breaks based on screen line/page capacity
4. Outputs:
   - `book.txt` — the original text
   - `book.idx` — array of uint32 byte offsets, one per page start
5. Future: could support `.epub` input, wrap in a web UI

### Upload to device

1. Long-press the button to enter sync mode
2. Device enables WiFi and starts a small web server
3. Browse to the device's IP from phone/laptop
4. Upload `book.txt` + `book.idx` via HTML file form
5. Device saves to LittleFS, resets reading position to page 0

## Reading Flow

1. Press button to wake / advance to next page
2. Device reads page offset from `book.idx`, seeks into `book.txt`
3. Renders text to e-ink display with OpenDyslexic Mono
4. Draws progress bar and battery icon (if low)
5. Saves current page number to NVS
6. Enters deep sleep after 30 seconds of inactivity
7. E-ink retains the display with zero power

## Storage Architecture

- **LittleFS:** `book.txt` and `book.idx` (the content)
- **NVS:** Current page number (frequent small writes, wear-leveled)
- **One book at a time** — uploading a new book replaces the old one

## WiFi

- **WiFiManager library** for credential management
- First boot (or unknown network): creates a "BookReader-Setup" AP for config
- WiFi only active during sync mode (long press trigger)
- No background connectivity, no cloud dependency

## Power Management

- **Deep sleep** after 30 seconds of no button press
- **Wake** on button press (GPIO0 interrupt)
- Button press during wake: advance page immediately
- With e-ink's zero-power display hold and sleep-heavy usage, expect weeks of battery life

## Development

- **Framework:** PlatformIO with Arduino framework
- **Key libraries:**
  - Heltec ESP32 e-ink driver
  - U8g2 or Adafruit GFX (font rendering)
  - WiFiManager (credential management)
  - ESPAsyncWebServer or similar (upload web server)
  - LittleFS (file storage)
  - NVS (reading position persistence)

## Future / V2 Ideas

- Proportional OpenDyslexic font (pre-processor approach makes this a font swap)
- `.epub` support in the pre-processor
- Web UI wrapper around the Python conversion script
- Multiple books with a simple selection menu
- Bookmark feature
- Back button / previous page
- Adjustable sleep timeout
- Sleep between page turns (if wake performance is fast enough)
