# lutmatch

Turn inspiration shots (Instagram reels, YouTube clips, screenshots) into `.cube` LUTs for your camera's
log footage, by measuring them rather than eyeballing them. Standalone: it doesn't touch Cutroom.

Built for Fujifilm **F-Log2** (X-T5) → Rec.709. F-Log is supported too.

## Setup

```sh
brew install ffmpeg            # exiftool is optional: brew install exiftool
./setup.sh                     # makes .venv with numpy, scipy, pillow, yt-dlp
./lm test                      # offline checks; should say OK
./lm build olive-teal          # rebuilds the olive-teal family's LUTs from the committed measurements
```

LUTs land in `families/<family>/luts/`: 33-point cubes (work everywhere; committed) and `65-point/`
(more accurate, for Resolve and Premiere; rebuilt, not committed). Apply one as the *input* LUT on the
log clip, after setting white balance and exposure.

## Doing a new look

Easiest: open Claude Code in this folder and say *"make a LUT family from these reels: <links>"*.
`CLAUDE.md` has the method. By hand:

```sh
./lm new moody-blue                       # then edit families/moody-blue/look.json: sources, frames, crop
./lm frames moody-blue                    # downloads, extracts frames, writes work/grids/ for picking patches
#   add patches to look.json: boxes on things that are white/grey/black in real life, and on skin
./lm boxes moody-blue                     # draws them; look at work/grids/boxes.png
./lm measure moody-blue                   # -> measured.json
./lm build moody-blue                     # -> luts/
./lm check moody-blue ~/clip.mov@12       # every look on a frame of your footage -> luts/check.png
```

## Your camera

`cameras/x-t5-flog2.json` holds skin samples from your own F-Log2 footage. Every family uses them to
put your skin where the reference puts skin. To add some (use card originals, not AirDrop or Photos
copies):

```sh
./lm camera-frame ~/clip.mov@40 --family olive-teal      # gridded frame to read box coordinates from
./lm camera-add x-t5-flog2 ~/clip.mov@40 --box 1050,1180,1200,1260 --neutral 450,1150,600,1300 --label forehead
```

## Files

```
lm, setup.sh, requirements.txt   run it / set it up
lutmatch/        the code: flog (camera curves), colorlib (OKLab, vectorscope), measure, look (the grade
                 model), fit (fits looks, writes cubes), media (ffmpeg, yt-dlp, grids), cli
families/<name>/ look.json (sources, patches, looks; hand-written), measured.json (from ./lm measure),
                 luts/ (from ./lm build), work/ (downloads and frames; not committed)
cameras/         skin samples from your camera
tests/           ./lm test
CLAUDE.md        the method, for Claude
```

## The families so far

**olive-teal**: two Sydney creator reels. Four looks:
- **olive-teal**: dense shadows, teal blacks, olive/mint highlights, muted colour.
- **warm**: the same grade in the reference's sunlight; whites go amber.
- **blue-hour**: the night shot; daylight surfaces go teal while skin, wood and lamps stay warm.
- **clean**: true neutrals and broadcast exposure.

Plus soft (60%) versions and a tone-only cube. Exposure for the reference looks, on an F-Log2
waveform: 18% grey ≈ 38 IRE, key-lit skin ≈ 47, white ≈ 58.
