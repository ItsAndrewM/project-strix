# Feeding Strix a recorded game

A game's source must be a direct video URL that answers range requests: the slicer runs ffprobe and ffmpeg against
it. A YouTube watch page is not one, and the direct links yt-dlp can print expire within hours and are often bound to
the downloading IP, so the slicer container would be refused. The working path is download once, store the file in the
`strix` bucket, and give the game a presigned URL for it.

You need `yt-dlp`, `ffmpeg` (yt-dlp merges video and audio with it; `brew install ffmpeg`), the `aws` CLI, and the
Worker's R2 token in your shell:

```bash
export R2_ACCESS_KEY_ID=...        # the token from docs/runbooks/setup.md step 6
export R2_SECRET_ACCESS_KEY=...
```

## 1. Download at 720p

720p is all Strix uses: the model sees 480p and the viewer gets 720p. A three-hour broadcast is about 3 GB at this
size. `+faststart` puts the index at the front of the file so the slicer can seek without first reading the end.

```bash
yt-dlp -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]" \
  --merge-output-format mp4 --postprocessor-args "ffmpeg:-movflags +faststart" \
  -o sjs-vs-min-2025-10-26.mp4 "https://www.youtube.com/watch?v=YXKVkd39ZSw"
```

## 2. Upload and mint the URL

```bash
scripts/r2-source.sh put sjs-vs-min-2025-10-26.mp4 sources/sjs-vs-min-2025-10-26.mp4
scripts/r2-source.sh url sources/sjs-vs-min-2025-10-26.mp4
```

The upload is multipart, so multi-gigabyte files are fine. The second command prints a URL valid for seven days; paste
it as the game's video URL. Keys under `sources/` are never touched by the app, so re-sourcing a game or deleting it
leaves the file in place.

## 3. Start the game

On the probe frame, drag the crop box over the broadcast score bug before pressing **Start**: that overlay is exactly
what the model must not see. A full game is roughly 430 thirty-second clips in 18 ranges, six slicing at once, and one
Clef call per clip.

When checking results against a boxscore, match by period and event order, not by video time: intermissions and
stoppages mean the video clock and the game clock drift apart, which is why the clock is always entered by hand.
