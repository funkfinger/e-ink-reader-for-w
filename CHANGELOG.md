# Changelog

## 2026-03-24

### Firmware
- Initial PlatformIO project for Heltec Wireless Paper V1.2 (ESP32-S3)
- E-ink splash screen on boot
- Multi-mode button input: single press (next page), double press (previous page), long press (page info)
- Deep sleep after 30 seconds of inactivity, wake on button press
- LittleFS book reader — loads `book.txt` + `book.idx`, renders paginated text
- NVS page position persistence across reboots and sleep cycles
- OpenDyslexic Regular 8pt bitmap font for readability
- Page number display (e.g. "1/8103") in small text at bottom right
- Progress bar at bottom of screen

### Web App (Node.js/Express)
- Upload `.txt` file via web interface
- Text sanitization: curly quotes, em/en dashes, ellipsis replaced with ASCII equivalents
- Word-wrap and pagination engine (16 chars/line, 5 lines/page)
- Preview paginated output in browser
- Download `book.zip` containing `book.txt` + `book.idx` for device
- 26 passing tests (vitest) covering pagination, sanitization, and server routes
