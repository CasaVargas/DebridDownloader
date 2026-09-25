# App icon

- `app-icon.svg` is the master for the bundled app icons: a macOS-style squircle with margin and shadow on a 1024 canvas.
- `app-icon-flat.svg` is the same mark full-bleed, cropped to the squircle. It's used in the app's sidebar and About page (`public/app-icon.png`) and on the docs site (`docs/icon.png`, `docs/favicon.ico`).

The colours follow the app's accent tokens (`--accent: #10b981`) in `src/styles/tokens.css`.

## Regenerating

1. Render `app-icon.svg` to a 1024×1024 PNG with a transparent background. Headless Chrome works:
   `--headless=new --default-background-color=00000000 --window-size=1024,1024 --screenshot=icon.png`.
2. Run `npx tauri icon icon.png -o src-tauri/icons`.
3. Delete the `android/` and `ios/` folders it creates. This is a desktop-only app.
