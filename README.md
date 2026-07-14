# Portfolio — Ricardo López Novelo

Static site. No build step, no dependencies. Open `index.html` in a browser to preview.

## Publish on GitHub Pages (free, ~3 minutes)

1. Create a new **public** repository named exactly `ricardonovelot.github.io` at github.com/new
2. From this folder, run:

   ```
   git init
   git add .
   git commit -m "Portfolio site"
   git branch -M main
   git remote add origin git@github.com:ricardonovelot/ricardonovelot.github.io.git
   git push -u origin main
   ```

3. The site goes live at **https://ricardonovelot.github.io** within a minute or two.
   (Settings → Pages should show "Deployed from main" automatically for a repo with this name.)

## Replace the media placeholders

Every grey slot in the case studies is a `<figure class="media">` with an HTML
comment right above it saying what capture belongs there. Drop an image into
this folder and swap the placeholder `<div class="slot-label">` for:

```html
<img src="your-file.jpg" alt="describe what is shown">
```

Good sources you already have:
- Simulator screen recordings of June in `~/Documents` (June 2025 .mp4 files)
- Screenshots in the Demos GitHub repo
- The MetroZONE visuals on your Behance

## Editing the site

Press Cmd+Shift+E on the live site (or add `?edit` to the URL) to edit text
and move, add, or delete sections in place. Saving commits to this repo.
