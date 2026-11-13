PIXEL DAY STREAK TRACKER

Files:
- index.html: app structure
- style.css: responsive styling and positioning
- script.js: mood picker, one-way completion, streak calculations and LocalStorage
- reference.png: the supplied original dashboard artwork

Run:
1. Keep all four files in the same folder.
2. Open index.html in a modern browser.
3. Click a day that has already arrived and choose a mood.
4. The day becomes locked and its mood is saved in this browser.

Notes:
- Data is stored in LocalStorage on this browser/device.
- Current streak counts consecutive completed days ending today, or yesterday if today is not completed yet.
- Longest streak is retained as a historical maximum.
- Monthly progress counts completed dates in the current calendar month.
- Future dates cannot be completed.
