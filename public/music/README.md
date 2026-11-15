# Music

Songs the radio plays from this device (no YouTube, no video: the smooth option on the TV).

## Add a song

1. Put the audio file in this folder. Use **Opus in an Ogg file (`.ogg`)** or **MP3 / AAC (`.m4a`)**; both play on Android TV
   and in every browser. Opus at 64-96 kbps is small and sounds good:
   `ffmpeg -i song.flac -c:a libopus -b:a 80k song.ogg`
2. Add an entry to `index.json`:

   ```json
   { "id": "my-song", "file": "my-song.ogg", "title": "My Song", "artist": "Me", "seconds": 215 }
   ```

   - `id`: any short unique text (letters, digits, dashes).
   - `file`: the file name in this folder.
   - `title`, `artist`: what the announcer says ("Up next, My Song by Me."). `artist` may be empty.
   - `seconds`: the length (only shown on the My Music page).
3. Record the announcer's line for the new song: `node scripts/bake-voice.mjs` (dev server running), then rebuild the app.

Only music you may use: see `CREDITS.txt` for the songs already here (CC0).
