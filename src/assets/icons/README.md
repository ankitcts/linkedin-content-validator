# Extension icons

Add the toolbar/store icons here, then reference them from `manifest.json`:

```
icon16.png   16x16   toolbar (favicon size)
icon32.png   32x32   Windows / retina toolbar
icon48.png   48x48   extensions management page
icon128.png  128x128 installation + Chrome Web Store
```

Then add to `manifest.json`:

```json
"icons": {
  "16": "assets/icons/icon16.png",
  "32": "assets/icons/icon32.png",
  "48": "assets/icons/icon48.png",
  "128": "assets/icons/icon128.png"
},
"action": {
  "default_icon": {
    "16": "assets/icons/icon16.png",
    "32": "assets/icons/icon32.png"
  }
}
```

Icons are intentionally omitted from the manifest until the assets exist, so the
extension still loads unpacked in the meantime (Chrome falls back to a default).
